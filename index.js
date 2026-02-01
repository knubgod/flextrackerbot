import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { request } from 'undici';
import Database from 'better-sqlite3';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let lastPollStartedAt = null;
let lastPollFinishedAt = null;
let lastPollError = null;

const LOCAL_ROSTER_PATH = path.join(process.cwd(), 'roster.local.json');

function loadLocalRoster() {
  if (!fs.existsSync(LOCAL_ROSTER_PATH)) return [];

  try {
    const raw = fs.readFileSync(LOCAL_ROSTER_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('Failed to load roster.local.json:', err.message);
    return [];
  }
}

// How many roster players must be on SAME TEAM in SAME FLEX match
const THRESHOLD = 3;

// Poll interval (ms). 60s is a safe starting point for Riot rate limits.
const POLL_MS = 60_000;

/**
 * -----------------------------------------------------------
 */

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID;

if (!DISCORD_TOKEN || !RIOT_API_KEY) {
  console.error("Missing .env values. Need DISCORD_TOKEN, RIOT_API_KEY");
  process.exit(1);
}

// Riot routing (NA)
const PLATFORM_HOST = "https://na1.api.riotgames.com";      // spectator/summoner endpoints
const REGIONAL_HOST = "https://americas.api.riotgames.com"; // account-v1 + match-v5
const FLEX_QUEUE_ID = 440; // Ranked Flex SR

// SQLite DB (persists wins/losses)
const db = new Database("bot.db");
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

function riotIdKey(gameName, tagLine) {
  return `${gameName}#${tagLine}`.toLowerCase();
}

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

function canEditRecord(interaction) {
  const ownerId = process.env.OWNER_USER_ID;
  const isOwner = ownerId && interaction.user?.id === ownerId;
  const isAdmin = interaction.memberPermissions?.has('Administrator');
  return Boolean(isOwner || isAdmin);
}

function opggSummonerUrl(riotDisplay) {
  // riotDisplay like "FoURTwENTY#NA1"
  const [gameName, tagLine] = riotDisplay.split('#');
  // OP.GG uses URL encoding; format is generally /<GameName>-<TagLine>
  const slug = `${gameName}-${tagLine}`.replace(/\s+/g, '%20');
  return `https://www.op.gg/lol/summoners/na/${slug}`;
}

async function getOrCreatePlayer(gameName, tagLine) {
  const key = riotIdKey(gameName, tagLine);
  const display = `${gameName}#${tagLine}`;

  const row = db
    .prepare("SELECT puuid, summoner_id, riot_display FROM players WHERE riot_id = ?")
    .get(key);

  if (row) return row;

  // Riot ID -> PUUID (global)
  const acct = await riotGet(
    `${REGIONAL_HOST}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  if (!acct?.puuid) throw new Error(`Could not find Riot ID: ${display}`);

  // IMPORTANT:
  // Summoner-V4 may not return "id" with dev keys right now,
  // so we store the PUUID into summoner_id just to satisfy the NOT NULL schema.
  db.prepare(
    "INSERT OR REPLACE INTO players (riot_id, riot_display, puuid, summoner_id) VALUES (?, ?, ?, ?)"
  ).run(key, display, acct.puuid, acct.puuid);

  return { puuid: acct.puuid, summoner_id: acct.puuid, riot_display: display };
}

async function getActiveGame(puuid) {
  // Spectator v5 supports looking up current game by PUUID
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

function finalizeStackMatch({ gameId, matchId, finishedAt, stackSize, win, queueId }) {
  db.prepare(`
    UPDATE stack_matches
    SET match_id = ?, finished_at = ?, stack_size = ?, win = ?, queue_id = ?
    WHERE game_id = ?
  `).run(matchId, finishedAt, stackSize, win, queueId, String(gameId));
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

const DEFAULT_THRESHOLD = 3;
const DEFAULT_POLL_MS = 60_000;

function getGlobalConfig() {
  return db.prepare(`SELECT active_guild_id, poll_ms FROM global_config WHERE id = 1`).get()
    || { active_guild_id: null, poll_ms: DEFAULT_POLL_MS };
}

function setGlobalConfigActiveGuild(guildId) {
  db.prepare(`UPDATE global_config SET active_guild_id = ? WHERE id = 1`).run(guildId);
}

function setGlobalPollMs(ms) {
  db.prepare(`UPDATE global_config SET poll_ms = ? WHERE id = 1`).run(ms);
}

function getGuildConfig(guildId) {
  const row = db.prepare(`SELECT guild_id, alert_channel_id, threshold FROM guild_config WHERE guild_id = ?`).get(guildId);
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
    total: { wins: autoWins + manualWins, losses: autoLosses + manualLosses }
  };
}

function addRosterPlayerToDb(gameName, tagLine, puuid) {
  const key = `${gameName}#${tagLine}`.toLowerCase();
  const display = `${gameName}#${tagLine}`;
  // summoner_id column exists from earlier schema; we store puuid there to satisfy NOT NULL
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

function setManualRecord(wins, losses) {
  db.prepare(`UPDATE manual_record SET wins = ?, losses = ? WHERE id = 1`).run(wins, losses);
}

function addManualRecord(winsDelta, lossesDelta) {
  db.prepare(`UPDATE manual_record SET wins = wins + ?, losses = losses + ? WHERE id = 1`).run(winsDelta, lossesDelta);
}

async function riotIdToPuuid(gameName, tagLine) {
  const acct = await riotGet(
    `${REGIONAL_HOST}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  return acct?.puuid || null;
}

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
  const t = match.info.teams.find(x => x.teamId === teamId);
  return !!t?.win;
}

async function postEmbed(client, embed) {
  const { alertChannelId } = getEffectiveConfig();
  if (!alertChannelId) throw new Error("No alert channel configured (set ALERT_CHANNEL_ID in .env or /config set alert-channel)");

  const channel = await client.channels.fetch(alertChannelId);
  if (!channel?.isTextBased()) throw new Error("Configured alert channel is not a text channel");
  await channel.send({ embeds: [embed] });
}

function hasStackMatchRow(gameId) {
  return !!db.prepare("SELECT game_id FROM stack_matches WHERE game_id = ?").get(String(gameId));
}

// Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Load command modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commands = new Map();

// Interaction Handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;

  const ctx = {
    pollOnce,
    getTeamStackRecord,
    // roster helpers
    riotIdToPuuid,
    addRosterPlayerToDb,
    removeRosterPlayerFromDb,
    listRosterFromDb,
    // ...existing
    canEditRecord,
    opggSummonerUrl,
    getGlobalConfig,
    setGlobalConfigActiveGuild,
    setGlobalPollMs,
    getGuildConfig,
    upsertGuildConfig,
    getEffectiveConfig,
    // manual record helpers
    addManualRecord,
    setManualRecord,
    getLastPollStartedAt: () => lastPollStartedAt,
    getLastPollFinishedAt: () => lastPollFinishedAt,
    getLastPollError: () => lastPollError,

  };

  try {
    await cmd.execute(interaction, ctx);
  } catch (e) {
    console.error('Command error:', e);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'Command failed.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'Command failed.', ephemeral: true });
    }
  }
});

const commandsDir = path.join(__dirname, 'commands');
if (fs.existsSync(commandsDir)) {
  for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {

    const fullPath = path.join(commandsDir, file);
    const cmd = await import(pathToFileURL(fullPath).href);

    commands.set(cmd.data.name, cmd);
  }
}

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Optional local roster seeding (server-only)
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

  let DDRAGON_VERSION = null;

async function getDdragonVersion() {
  if (DDRAGON_VERSION) return DDRAGON_VERSION;

  const res = await request("https://ddragon.leagueoflegends.com/api/versions.json");
  const versions = await res.body.json();

  DDRAGON_VERSION = versions?.[0] || "14.1.1";
  return DDRAGON_VERSION;
}


   // Main loop (dynamic poll interval)
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
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
};

  loop(); // do NOT await
});

async function pollOnce() {
  // Roster from DB
  console.log(`[poll] ${new Date().toLocaleTimeString()} checking roster...`);
  const rosterRows = db.prepare("SELECT riot_display, puuid, summoner_id FROM players").all();
  if (rosterRows.length === 0) return;

  // Live flex participants among roster
  const liveFlex = [];

  for (const r of rosterRows) {
    const game = await getActiveGame(r.puuid);
    if (!game) continue;
    if (game.gameQueueConfigId !== FLEX_QUEUE_ID) continue;

    const me = game.participants.find(p => p.puuid === r.puuid);
    if (!me) continue;


    liveFlex.push({
      riot_display: r.riot_display,
      puuid: r.puuid,
      gameId: game.gameId,
      teamId: me.teamId
    });
  }

  // Find stacks (same gameId, same teamId)
  const byGame = groupBy(liveFlex, x => x.gameId);

  for (const [gameId, playersInGame] of byGame.entries()) {
    const byTeam = groupBy(playersInGame, x => x.teamId);

    for (const [teamId, stack] of byTeam.entries()) {
      const { threshold } = getEffectiveConfig();
    if (stack.length < threshold) continue;


      const detectedAt = Date.now();

      // Announce once
if (!hasStackMatchRow(gameId)) {
  const opggLines = stack.map(
    s => `• [${s.riot_display}](${opggSummonerUrl(s.riot_display)})`
  );

}


      // Watch it for completion + persist start
      upsertActiveGame({
        gameId,
        detectedAt,
        samplePuuid: stack[0].puuid,
        teamId: Number(teamId),
        stackSize: stack.length
      });

      ensureStackMatchStarted({
        gameId,
        startedAt: detectedAt,
        stackSize: stack.length,
        queueId: FLEX_QUEUE_ID
      });
    }
  }

  // Check active games for completion and post results
  const active = getActiveGames();
  if (active.length === 0) return;

  const puuidToDisplay = new Map(rosterRows.map(r => [r.puuid, r.riot_display]));
  const rosterPuuids = new Set(rosterRows.map(r => r.puuid));

  for (const row of active) {
    const done = await fetchCompletedMatchForGameId(row.sample_puuid, row.game_id);
    if (!done) continue;

    const { matchId, match } = done;
    const teamId = Number(row.team_id);
    const win = didTeamWin(match, teamId) ? 1 : 0;

    const rosterTeamParticipants = match.info.participants
      .filter(p => rosterPuuids.has(p.puuid) && p.teamId === teamId)
      .map(p => ({
        puuid: p.puuid,
        riot_display: puuidToDisplay.get(p.puuid) || p.summonerName,
        win
      }));

    finalizeStackMatch({
      gameId: row.game_id,
      matchId,
      finishedAt: Date.now(),
      stackSize: row.stack_size,
      win,
      queueId: FLEX_QUEUE_ID
    });

    insertPlayerResults(matchId, rosterTeamParticipants);

    const record = getTeamStackRecord();
    const wins = record.total.wins;
    const losses = record.total.losses;

    // Summary embed (match-level)
    const summary = new EmbedBuilder()
      .setTitle(`Flex stack finished: ${win ? "WIN" : "LOSS"}`)
      .addFields(
        { name: "Stack size", value: String(row.stack_size), inline: true },
        { name: "All-time stack record", value: `${wins}-${losses}`, inline: true },
        { name: "Match ID", value: matchId, inline: false }
      )
      .setTimestamp();

    // One embed per roster player (champ icon thumbnail)
    const ddragonVersion = await getDdragonVersion();

    const playerEmbeds = match.info.participants
      .filter(p => rosterPuuids.has(p.puuid) && p.teamId === teamId)
      .map(p => {
        const riotDisplay = puuidToDisplay.get(p.puuid) || p.summonerName;
        const opgg = opggSummonerUrl(riotDisplay);

        const champIconUrl =
          `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${p.championName}.png`;

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

    async function postEmbeds(client, embeds) {
  const { alertChannelId } = getEffectiveConfig();
  if (!alertChannelId) throw new Error("No alert channel configured (set ALERT_CHANNEL_ID in .env or /config set-alert-channel)");

  const channel = await client.channels.fetch(alertChannelId);
  if (!channel?.isTextBased()) throw new Error("Configured alert channel is not a text channel");
  await channel.send({ embeds });
}


    removeActiveGame(row.game_id);
  }
}

client.login(DISCORD_TOKEN);
