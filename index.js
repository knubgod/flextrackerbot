import "dotenv/config";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { request } from "undici";
import Database from "better-sqlite3";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* =========================================================
   [SECTION] Runtime health metrics (used by /status)
   ========================================================= */
let lastPollStartedAt = null;
let lastPollFinishedAt = null;
let lastPollError = null;

/* =========================================================
   [SECTION] Optional local roster seeding (server-only)
   - This file is not committed to Git
   - Lets you keep your personal roster without hardcoding it
   ========================================================= */
const LOCAL_ROSTER_PATH = path.join(process.cwd(), "roster.local.json");

function loadLocalRoster() {
  if (!fs.existsSync(LOCAL_ROSTER_PATH)) return [];

  try {
    const raw = fs.readFileSync(LOCAL_ROSTER_PATH, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("Failed to load roster.local.json:", err.message);
    return [];
  }
}

/* =========================================================
   [SECTION] Defaults (DB config can override these)
   ========================================================= */
const DEFAULT_THRESHOLD = 3;
const DEFAULT_POLL_MS = 60_000;

/* =========================================================
   [SECTION] Environment variables
   ========================================================= */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RIOT_API_KEY = process.env.RIOT_API_KEY;

if (!DISCORD_TOKEN || !RIOT_API_KEY) {
  console.error("Missing .env values. Need DISCORD_TOKEN, RIOT_API_KEY");
  process.exit(1);
}

/* =========================================================
   [SECTION] Riot routing + constants
   ========================================================= */
const PLATFORM_HOST = "https://na1.api.riotgames.com"; // spectator endpoints
const REGIONAL_HOST = "https://americas.api.riotgames.com"; // account-v1 + match-v5
const FLEX_QUEUE_ID = 440; // Ranked Flex SR

/* =========================================================
   [SECTION] SQLite DB + base schema + migrations
   ========================================================= */
const db = new Database("bot.db");

/**
 * Base schema (tables that existed before stats upgrades)
 * FIX NOTE: This block should be safe to run on every startup.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS players (
  riot_id TEXT PRIMARY KEY,
  riot_display TEXT NOT NULL,
  puuid TEXT NOT NULL,
  summoner_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS active_games (
  game_id TEXT PRIMARY KEY,
  detected_at INTEGER NOT NULL,
  sample_puuid TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  stack_size INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stack_matches (
  game_id TEXT PRIMARY KEY,
  match_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  stack_size INTEGER NOT NULL,
  win INTEGER,
  queue_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_results (
  match_id TEXT NOT NULL,
  puuid TEXT NOT NULL,
  riot_display TEXT NOT NULL,
  win INTEGER NOT NULL,
  PRIMARY KEY (match_id, puuid)
);

CREATE TABLE IF NOT EXISTS manual_record (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL
);

INSERT OR IGNORE INTO manual_record (id, wins, losses) VALUES (1, 0, 0);

CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  alert_channel_id TEXT,
  threshold INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS global_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_guild_id TEXT,
  poll_ms INTEGER NOT NULL
);

INSERT OR IGNORE INTO global_config (id, active_guild_id, poll_ms) VALUES (1, NULL, 60000);
`);

/**
 * --- Migrations for v1.2.0+ stats ---
 * FIX NOTE: Your crash came from creating an index on a column that didn't exist.
 * We now:
 *  1) add stack_matches.side (if missing)
 *  2) ensure enemy_champ_results exists
 *  3) ensure team_champ_results exists AND has champ column (ALTER if needed)
 *  4) create indexes only AFTER the columns exist
 */
function ensureMigrations() {
  // Add side column to stack_matches (BLUE/RED)
  try {
    db.exec(`ALTER TABLE stack_matches ADD COLUMN side TEXT`);
    console.log("[db] Migration: added stack_matches.side");
  } catch (e) {
    // "duplicate column name" is fine
    if (!String(e.message).includes("duplicate column name")) {
      console.warn("[db] Migration warning:", e.message);
    }
  }

  // Enemy champ tracking table (used by /stats)
  db.exec(`
    CREATE TABLE IF NOT EXISTS enemy_champ_results (
      match_id TEXT NOT NULL,
      champ TEXT NOT NULL,
      win INTEGER NOT NULL,
      PRIMARY KEY (match_id, champ)
    );
  `);

  // Team champ tracking table (used by /statsdetailed and /statsfive)
  // FIX NOTE: This is the correct schema. (Your prior version was missing champ + had type typos.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_champ_results (
      match_id TEXT NOT NULL,
      puuid TEXT NOT NULL,
      champ TEXT,
      win INTEGER NOT NULL,
      stack_size INTEGER NOT NULL,
      side TEXT,
      PRIMARY KEY (match_id, puuid)
    );
  `);

  // If team_champ_results existed from a broken migration, it may not have champ.
  // We detect and add it.
  try {
    const cols = db.prepare(`PRAGMA table_info(team_champ_results)`).all();
    const hasChamp = cols.some((c) => c.name === "champ");
    if (!hasChamp) {
      db.exec(`ALTER TABLE team_champ_results ADD COLUMN champ TEXT`);
      console.log("[db] Migration: added team_champ_results.champ");
    }
  } catch (e) {
    console.warn("[db] Migration warning (team_champ_results pragma/alter):", e.message);
  }

  // Helpful indexes (safe to run every startup)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_enemy_champ_results_champ
    ON enemy_champ_results(champ);
  `);

  // FIX NOTE: This one caused your crash before. It's safe now because champ exists.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_team_champ_results_champ
    ON team_champ_results(champ);
  `);
}

ensureMigrations();

/* =========================================================
   [SECTION] Riot HTTP helper
   ========================================================= */
async function riotGet(url) {
  const res = await request(url, { headers: { "X-Riot-Token": RIOT_API_KEY } });

  if (res.statusCode === 404) return null;

  if (res.statusCode === 429) {
    const retryAfter = Number(res.headers["retry-after"] || 2);
    throw new Error(`Rate limited (429). Retry after ~${retryAfter}s`);
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const txt = await res.body.text();
    throw new Error(`Riot error ${res.statusCode}: ${txt}`);
  }

  return res.body.json();
}

/* =========================================================
   [SECTION] Data Dragon version cache (champ icons)
   ========================================================= */
let DDRAGON_VERSION = null;

async function getDdragonVersion() {
  if (DDRAGON_VERSION) return DDRAGON_VERSION;

  try {
    const res = await request("https://ddragon.leagueoflegends.com/api/versions.json");
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`DDragon returned ${res.statusCode}`);
    }
    const versions = await res.body.json();
    DDRAGON_VERSION = versions?.[0] || "14.1.1";
  } catch (err) {
    DDRAGON_VERSION = "14.1.1";
    console.warn(`Falling back to DDragon ${DDRAGON_VERSION}: ${err.message}`);
  }

  return DDRAGON_VERSION;
}

/* =========================================================
   [SECTION] Permissions + URLs
   ========================================================= */
function canEditRecord(interaction) {
  const ownerId = process.env.OWNER_USER_ID;
  const isOwner = ownerId && interaction.user?.id === ownerId;
  const isAdmin = interaction.memberPermissions?.has("Administrator");
  return Boolean(isOwner || isAdmin);
}

function opggSummonerUrl(riotDisplay) {
  const [gameName, tagLine] = riotDisplay.split("#");
  const slug = `${gameName}-${tagLine}`.replace(/\s+/g, "%20");
  return `https://www.op.gg/lol/summoners/na/${slug}`;
}

/* =========================================================
   [SECTION] Player / roster helpers
   ========================================================= */
function riotIdKey(gameName, tagLine) {
  return `${gameName}#${tagLine}`.toLowerCase();
}

async function getOrCreatePlayer(gameName, tagLine) {
  const key = riotIdKey(gameName, tagLine);
  const display = `${gameName}#${tagLine}`;

  const row = db
    .prepare("SELECT puuid, summoner_id, riot_display FROM players WHERE riot_id = ?")
    .get(key);

  if (row) return row;

  const acct = await riotGet(
    `${REGIONAL_HOST}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  if (!acct?.puuid) throw new Error(`Could not find Riot ID: ${display}`);

  db.prepare(
    "INSERT OR REPLACE INTO players (riot_id, riot_display, puuid, summoner_id) VALUES (?, ?, ?, ?)"
  ).run(key, display, acct.puuid, acct.puuid);

  return { puuid: acct.puuid, summoner_id: acct.puuid, riot_display: display };
}

async function riotIdToPuuid(gameName, tagLine) {
  const acct = await riotGet(
    `${REGIONAL_HOST}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  return acct?.puuid || null;
}

function addRosterPlayerToDb(gameName, tagLine, puuid) {
  const key = `${gameName}#${tagLine}`.toLowerCase();
  const display = `${gameName}#${tagLine}`;
  db.prepare(`
    INSERT OR REPLACE INTO players (riot_id, riot_display, puuid, summoner_id)
    VALUES (?, ?, ?, ?)
  `).run(key, display, puuid, puuid);
}

function removeRosterPlayerFromDb(gameName, tagLine) {
  const key = `${gameName}#${tagLine}`.toLowerCase();
  db.prepare(`DELETE FROM players WHERE riot_id = ?`).run(key);
}

function listRosterFromDb() {
  return db.prepare(`SELECT riot_display, puuid FROM players ORDER BY riot_display ASC`).all();
}

/* =========================================================
   [SECTION] Live game detection
   ========================================================= */
async function getActiveGame(puuid) {
  return riotGet(`${PLATFORM_HOST}/lol/spectator/v5/active-games/by-summoner/${puuid}`);
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(item);
  }
  return m;
}

/* =========================================================
   [SECTION] DB helpers (active + matches)
   ========================================================= */
function upsertActiveGame({ gameId, detectedAt, samplePuuid, teamId, stackSize }) {
  db.prepare(`
    INSERT OR REPLACE INTO active_games (game_id, detected_at, sample_puuid, team_id, stack_size)
    VALUES (?, ?, ?, ?, ?)
  `).run(String(gameId), detectedAt, samplePuuid, teamId, stackSize);
}

function getActiveGames() {
  return db.prepare(`SELECT * FROM active_games`).all();
}

function removeActiveGame(gameId) {
  db.prepare(`DELETE FROM active_games WHERE game_id = ?`).run(String(gameId));
}

function ensureStackMatchStarted({ gameId, startedAt, stackSize, queueId }) {
  db.prepare(`
    INSERT OR IGNORE INTO stack_matches (game_id, started_at, stack_size, queue_id)
    VALUES (?, ?, ?, ?)
  `).run(String(gameId), startedAt, stackSize, queueId);
}

function finalizeStackMatch({ gameId, matchId, finishedAt, stackSize, win, queueId, side }) {
  db.prepare(`
    UPDATE stack_matches
    SET match_id = ?, finished_at = ?, stack_size = ?, win = ?, queue_id = ?, side = ?
    WHERE game_id = ?
  `).run(matchId, finishedAt, stackSize, win, queueId, side || null, String(gameId));
}

function insertPlayerResults(matchId, results) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO player_results (match_id, puuid, riot_display, win)
    VALUES (?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const r of results) stmt.run(matchId, r.puuid, r.riot_display, r.win ? 1 : 0);
  });
  tx();
}

// Track “vs enemy champions” results per match
function insertEnemyChampResults(matchId, enemyChamps, win) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO enemy_champ_results (match_id, champ, win)
    VALUES (?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const champ of enemyChamps) stmt.run(matchId, champ, win ? 1 : 0);
  });

  tx();
}

// Track roster players’ champs for team performance stats
function insertTeamChampResults(matchId, rows) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO team_champ_results
      (match_id, puuid, champ, win, stack_size, side)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const r of rows) {
      stmt.run(matchId, r.puuid, r.champ, r.win ? 1 : 0, r.stack_size, r.side);
    }
  });

  tx();
}

/* =========================================================
   [SECTION] Config (DB-first, .env fallback)
   ========================================================= */
function getGlobalConfig() {
  return (
    db.prepare(`SELECT active_guild_id, poll_ms FROM global_config WHERE id = 1`).get() || {
      active_guild_id: null,
      poll_ms: DEFAULT_POLL_MS,
    }
  );
}

function setGlobalConfigActiveGuild(guildId) {
  db.prepare(`UPDATE global_config SET active_guild_id = ? WHERE id = 1`).run(guildId);
}

function setGlobalPollMs(ms) {
  db.prepare(`UPDATE global_config SET poll_ms = ? WHERE id = 1`).run(ms);
}

function getGuildConfig(guildId) {
  const row = db
    .prepare(`SELECT guild_id, alert_channel_id, threshold FROM guild_config WHERE guild_id = ?`)
    .get(guildId);
  if (row) return row;
  return { guild_id: guildId, alert_channel_id: null, threshold: DEFAULT_THRESHOLD };
}

function upsertGuildConfig({ guildId, alertChannelId = null, threshold = DEFAULT_THRESHOLD }) {
  db.prepare(`
    INSERT INTO guild_config (guild_id, alert_channel_id, threshold)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      alert_channel_id = COALESCE(excluded.alert_channel_id, guild_config.alert_channel_id),
      threshold = COALESCE(excluded.threshold, guild_config.threshold)
  `).run(guildId, alertChannelId, threshold);
}

function getEffectiveConfig() {
  const g = getGlobalConfig();
  const activeGuildId = g.active_guild_id;
  const pollMs = g.poll_ms ?? DEFAULT_POLL_MS;

  let threshold = DEFAULT_THRESHOLD;
  let alertChannelId = process.env.ALERT_CHANNEL_ID || null;

  if (activeGuildId) {
    const gc = getGuildConfig(activeGuildId);
    threshold = gc.threshold ?? DEFAULT_THRESHOLD;
    alertChannelId = gc.alert_channel_id || alertChannelId;
  }

  return { activeGuildId, pollMs, threshold, alertChannelId };
}

/* =========================================================
   [SECTION] Records
   ========================================================= */
function getTeamStackRecord() {
  const auto = db.prepare(`
    SELECT
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM stack_matches
    WHERE win IS NOT NULL
  `).get();

  const manual = db.prepare(`SELECT wins, losses FROM manual_record WHERE id = 1`).get();

  const autoWins = auto?.wins || 0;
  const autoLosses = auto?.losses || 0;
  const manualWins = manual?.wins || 0;
  const manualLosses = manual?.losses || 0;

  return {
    auto: { wins: autoWins, losses: autoLosses },
    manual: { wins: manualWins, losses: manualLosses },
    total: { wins: autoWins + manualWins, losses: autoLosses + manualLosses },
  };
}

function setManualRecord(wins, losses) {
  db.prepare(`UPDATE manual_record SET wins = ?, losses = ? WHERE id = 1`).run(wins, losses);
}

function addManualRecord(winsDelta, lossesDelta) {
  db.prepare(`UPDATE manual_record SET wins = wins + ?, losses = losses + ? WHERE id = 1`).run(
    winsDelta,
    lossesDelta
  );
}

/* =========================================================
   [SECTION] Match completion helpers
   ========================================================= */
async function fetchCompletedMatchForGameId(samplePuuid, gameId) {
  const ids = await riotGet(
    `${REGIONAL_HOST}/lol/match/v5/matches/by-puuid/${samplePuuid}/ids?start=0&count=15`
  );
  if (!Array.isArray(ids)) return null;

  for (const matchId of ids) {
    const match = await riotGet(`${REGIONAL_HOST}/lol/match/v5/matches/${matchId}`);
    if (!match?.info) continue;
    if (String(match.info.gameId) === String(gameId)) return { matchId, match };
  }
  return null;
}

function didTeamWin(match, teamId) {
  const t = match.info.teams.find((x) => x.teamId === teamId);
  return !!t?.win;
}

/**
 * FIX NOTE: Use this helper everywhere so we never duplicate side logic
 * or accidentally typo teamId/teamID again.
 */
function getSideFromTeamId(teamId) {
  if (teamId === 100) return "BLUE";
  if (teamId === 200) return "RED";
  return null;
}

function hasStackMatchRow(gameId) {
  return !!db.prepare("SELECT game_id FROM stack_matches WHERE game_id = ?").get(String(gameId));
}

/* =========================================================
   [SECTION] Discord posting helpers
   ========================================================= */
async function postEmbed(client, embed) {
  const { alertChannelId } = getEffectiveConfig();
  if (!alertChannelId)
    throw new Error(
      "No alert channel configured (set ALERT_CHANNEL_ID in .env or /config set alert-channel)"
    );

  const channel = await client.channels.fetch(alertChannelId);
  if (!channel?.isTextBased()) throw new Error("Configured alert channel is not a text channel");
  await channel.send({ embeds: [embed] });
}

async function postEmbeds(client, embeds) {
  const { alertChannelId } = getEffectiveConfig();
  if (!alertChannelId)
    throw new Error(
      "No alert channel configured (set ALERT_CHANNEL_ID in .env or /config set alert-channel)"
    );

  const channel = await client.channels.fetch(alertChannelId);
  if (!channel?.isTextBased()) throw new Error("Configured alert channel is not a text channel");
  await channel.send({ embeds });
}

/* =========================================================
   [SECTION] Discord client + command loader
   ========================================================= */
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commands = new Map();

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;

  // Context passed to every command module
  const ctx = {
    db, // REQUIRED for stats commands
    pollOnce,
    getTeamStackRecord,

    // roster helpers
    riotIdToPuuid,
    addRosterPlayerToDb,
    removeRosterPlayerFromDb,
    listRosterFromDb,

    // config helpers
    getGlobalConfig,
    setGlobalConfigActiveGuild,
    setGlobalPollMs,
    getGuildConfig,
    upsertGuildConfig,
    getEffectiveConfig,

    // misc
    canEditRecord,
    opggSummonerUrl,

    // manual record helpers
    addManualRecord,
    setManualRecord,

    // status helpers
    getLastPollStartedAt: () => lastPollStartedAt,
    getLastPollFinishedAt: () => lastPollFinishedAt,
    getLastPollError: () => lastPollError,
  };

  try {
    await cmd.execute(interaction, ctx);
  } catch (e) {
    console.error("Command error:", e);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "Command failed.", ephemeral: true });
    } else {
      await interaction.reply({ content: "Command failed.", ephemeral: true });
    }
  }
});

// Load all ./commands/*.js
const commandsDir = path.join(__dirname, "commands");
if (fs.existsSync(commandsDir)) {
  for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith(".js"))) {
    const fullPath = path.join(commandsDir, file);
    const cmd = await import(pathToFileURL(fullPath).href);
    commands.set(cmd.data.name, cmd);
  }
}

/* =========================================================
   [SECTION] Startup + polling loop
   ========================================================= */
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Seed roster from roster.local.json if present
  const localRoster = loadLocalRoster();
  if (localRoster.length > 0) {
    console.log(`Seeding roster from roster.local.json (${localRoster.length} players)`);
    for (const p of localRoster) {
      try {
        const row = await getOrCreatePlayer(p.gameName, p.tagLine);
        console.log(`Roster OK: ${row.riot_display}`);
      } catch (e) {
        console.error(`Roster failed for ${p.gameName}#${p.tagLine}: ${e.message}`);
      }
    }
  }

  // Poll loop
  const loop = async () => {
    while (true) {
      lastPollStartedAt = Date.now();
      lastPollError = null;

      try {
        await pollOnce();
        lastPollFinishedAt = Date.now();
      } catch (e) {
        lastPollError = e?.message || String(e);
        console.error("Poll error:", lastPollError);
      }

      const { pollMs } = getEffectiveConfig();
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  };

  loop(); // do NOT await
});

/* =========================================================
   [SECTION] Core logic: pollOnce()
   - detects live stacks
   - tracks completion
   - posts final embeds
   - writes stats for /stats, /statsdetailed, /statsfive
   ========================================================= */
async function pollOnce() {
  console.log(`[poll] ${new Date().toLocaleTimeString()} checking roster...`);

  const rosterRows = db.prepare("SELECT riot_display, puuid, summoner_id FROM players").all();
  if (rosterRows.length === 0) return;

  // ----- Live flex participants among roster -----
  const liveFlex = [];

  for (const r of rosterRows) {
    const game = await getActiveGame(r.puuid);
    if (!game) continue;
    if (game.gameQueueConfigId !== FLEX_QUEUE_ID) continue;

    const me = game.participants.find((p) => p.puuid === r.puuid);
    if (!me) continue;

    liveFlex.push({
      riot_display: r.riot_display,
      puuid: r.puuid,
      gameId: game.gameId,
      teamId: me.teamId,
    });
  }

  // ----- Find stacks (same gameId, same teamId) -----
  const byGame = groupBy(liveFlex, (x) => x.gameId);

  for (const [gameId, playersInGame] of byGame.entries()) {
    const byTeam = groupBy(playersInGame, (x) => x.teamId);

    for (const [teamId, stack] of byTeam.entries()) {
      const { threshold } = getEffectiveConfig();
      if (stack.length < threshold) continue;

      const detectedAt = Date.now();

      // Announce once
      if (!hasStackMatchRow(gameId)) {
        const opggLines = stack.map((s) => `• [${s.riot_display}](${opggSummonerUrl(s.riot_display)})`);
        const started = new EmbedBuilder()
          .setTitle(`Flex stack detected (${stack.length})`)
          .setDescription(opggLines.join("\n"))
          .addFields(
            { name: "Game ID", value: String(gameId), inline: true },
            { name: "Team ID", value: String(teamId), inline: true }
          )
          .setTimestamp();

        await postEmbed(client, started);
      }

      // Persist active game + start row
      upsertActiveGame({
        gameId,
        detectedAt,
        samplePuuid: stack[0].puuid,
        teamId: Number(teamId),
        stackSize: stack.length,
      });

      ensureStackMatchStarted({
        gameId,
        startedAt: detectedAt,
        stackSize: stack.length,
        queueId: FLEX_QUEUE_ID,
      });
    }
  }

  // ----- Check active games for completion -----
  const active = getActiveGames();
  if (active.length === 0) return;

  const puuidToDisplay = new Map(rosterRows.map((r) => [r.puuid, r.riot_display]));
  const rosterPuuids = new Set(rosterRows.map((r) => r.puuid));

  for (const row of active) {
    const done = await fetchCompletedMatchForGameId(row.sample_puuid, row.game_id);
    if (!done) continue;

    const { matchId, match } = done;
    const teamId = Number(row.team_id);
    const win = didTeamWin(match, teamId) ? 1 : 0;
    const side = getSideFromTeamId(teamId);

    // Store player results
    const rosterTeamParticipants = match.info.participants
      .filter((p) => rosterPuuids.has(p.puuid) && p.teamId === teamId)
      .map((p) => ({
        puuid: p.puuid,
        riot_display: puuidToDisplay.get(p.puuid) || p.summonerName,
        win,
      }));

    finalizeStackMatch({
      gameId: row.game_id,
      matchId,
      finishedAt: Date.now(),
      stackSize: row.stack_size,
      win,
      queueId: FLEX_QUEUE_ID,
      side,
    });

    insertPlayerResults(matchId, rosterTeamParticipants);

    // Store roster players' champs for this match (team performance stats)
    // FIX NOTE: your old code used p.teamID (wrong). It must be p.teamId.
    const teamChampRows = match.info.participants
      .filter((p) => rosterPuuids.has(p.puuid) && p.teamId === teamId)
      .map((p) => ({
        puuid: p.puuid,
        champ: p.championName,
        win: Boolean(win),
        stack_size: Number(row.stack_size),
        side,
      }));

    insertTeamChampResults(matchId, teamChampRows);

    // Track enemy champs for /stats*
    const enemyChamps = match.info.participants
      .filter((p) => p.teamId !== teamId)
      .map((p) => p.championName);
    insertEnemyChampResults(matchId, enemyChamps, win);

    // ----- Build and post embeds -----
    const record = getTeamStackRecord();
    const wins = record.total.wins;
    const losses = record.total.losses;

    const summary = new EmbedBuilder()
      .setTitle(`Flex stack finished: ${win ? "WIN" : "LOSS"}`)
      .addFields(
        { name: "Stack size", value: String(row.stack_size), inline: true },
        { name: "All-time stack record", value: `${wins}-${losses}`, inline: true },
        { name: "Match ID", value: matchId, inline: false }
      )
      .setTimestamp();

    const ddragonVersion = await getDdragonVersion();

    const playerEmbeds = match.info.participants
      .filter((p) => rosterPuuids.has(p.puuid) && p.teamId === teamId)
      .map((p) => {
        const riotDisplay = puuidToDisplay.get(p.puuid) || p.summonerName;
        const opgg = opggSummonerUrl(riotDisplay);

        const champIconUrl = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${p.championName}.png`;

        return new EmbedBuilder()
          .setTitle(riotDisplay)
          .setURL(opgg)
          .setThumbnail(champIconUrl)
          .addFields(
            { name: "Champion", value: p.championName, inline: true },
            { name: "K/D/A", value: `${p.kills}/${p.deaths}/${p.assists}`, inline: true }
          );
      });

    await postEmbeds(client, [summary, ...playerEmbeds]);

    // Cleanup
    removeActiveGame(row.game_id);
  }
}

client.login(DISCORD_TOKEN);
