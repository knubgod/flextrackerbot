import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

const MIN_GAMES_DEFAULT = 3;
const LIMIT = 8;

export const data = new SlashCommandBuilder()
  .setName("statsdetailed")
  .setDescription("Detailed stats (team champs, enemy champs, side WR, 5-stack record).")
  .addIntegerOption(o =>
    o.setName("min_games")
      .setDescription("Minimum games before a champ appears in lists (default 3).")
      .setMinValue(1)
      .setMaxValue(50)
      .setRequired(false)
  );

export async function execute(interaction, ctx) {
  const db = ctx?.db ?? (typeof ctx?.getDb === "function" ? ctx.getDb() : null);
  if (!db) {
    return interaction.reply({
      content: "Stats database not available (ctx.db missing).",
      ephemeral: true
    });
  }

  const MIN_GAMES = interaction.options.getInteger("min_games") ?? MIN_GAMES_DEFAULT;

  // Overall record (auto+manual if available)
  let overallWins = 0;
  let overallLosses = 0;
  if (typeof ctx.getTeamStackRecord === "function") {
    const rec = ctx.getTeamStackRecord();
    overallWins = rec?.total?.wins ?? 0;
    overallLosses = rec?.total?.losses ?? 0;
  } else {
    const auto = db.prepare(`
      SELECT
        SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
      FROM stack_matches
      WHERE win IS NOT NULL
    `).get();
    overallWins = auto?.wins || 0;
    overallLosses = auto?.losses || 0;
  }

  // 5-stack record
  const five = db.prepare(`
    SELECT
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM stack_matches
    WHERE win IS NOT NULL AND stack_size = 5
  `).get();

  const fiveWins = five?.wins || 0;
  const fiveLosses = five?.losses || 0;
  const fiveText = (fiveWins + fiveLosses) === 0
    ? "No 5-stack matches recorded yet."
    : `**${fiveWins}-${fiveLosses}**`;

  // Side record (all stacks)
  const sides = db.prepare(`
    SELECT side,
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM stack_matches
    WHERE win IS NOT NULL AND side IS NOT NULL
    GROUP BY side
  `).all();

  const sideMap = new Map(sides.map(r => [r.side, r]));
  const blue = sideMap.get("BLUE") || { wins: 0, losses: 0 };
  const red = sideMap.get("RED") || { wins: 0, losses: 0 };
  const sideText =
    ((blue.wins + blue.losses + red.wins + red.losses) === 0)
      ? "No side data recorded yet."
      : `Blue: **${blue.wins}-${blue.losses}**\nRed: **${red.wins}-${red.losses}**`;

  // Team champ performance (all stacks)
  const mostPlayed = db.prepare(`
    SELECT champ, COUNT(*) AS games,
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM team_champ_results
    GROUP BY champ
    ORDER BY games DESC
    LIMIT ?
  `).all(LIMIT);

  const best = db.prepare(`
    SELECT champ, COUNT(*) AS games,
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM team_champ_results
    GROUP BY champ
    HAVING COUNT(*) >= ?
    ORDER BY (CAST(SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) DESC
    LIMIT ?
  `).all(MIN_GAMES, LIMIT);

  const worst = db.prepare(`
    SELECT champ, COUNT(*) AS games,
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM team_champ_results
    GROUP BY champ
    HAVING COUNT(*) >= ?
    ORDER BY (CAST(SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) ASC
    LIMIT ?
  `).all(MIN_GAMES, LIMIT);

  const fmtChampLine = (r) => {
    const wr = r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0;
    return `• **${r.champ}** — ${r.wins}-${r.losses} (${wr}% WR, ${r.games})`;
  };

  const mostPlayedText = mostPlayed.length
    ? mostPlayed.map(fmtChampLine).join("\n")
    : "No team champ data yet (play some matches with the bot running).";

  const bestText = best.length
    ? best.map(fmtChampLine).join("\n")
    : `Not enough data yet (need ${MIN_GAMES}+ games on a champ).`;

  const worstText = worst.length
    ? worst.map(fmtChampLine).join("\n")
    : `Not enough data yet (need ${MIN_GAMES}+ games on a champ).`;

  // Enemy champ struggles (all stacks)
  const enemyWorst = db.prepare(`
    SELECT champ,
      COUNT(*) AS games,
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM enemy_champ_results
    GROUP BY champ
    HAVING COUNT(*) >= ?
    ORDER BY (CAST(SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) ASC
    LIMIT ?
  `).all(MIN_GAMES, LIMIT);

  const enemyWorstText = enemyWorst.length
    ? enemyWorst.map(fmtChampLine).join("\n")
    : `Not enough data yet (need ${MIN_GAMES}+ games vs a champ).`;

  const embed = new EmbedBuilder()
    .setTitle("Flex Tracker — Detailed Stats (All Stacks)")
    .addFields(
      { name: "Overall record", value: `**${overallWins}-${overallLosses}**`, inline: true },
      { name: "5-stack record", value: fiveText, inline: true },
      { name: "Side record", value: sideText, inline: true },

      { name: "Most played champs (team)", value: mostPlayedText, inline: false },
      { name: "Best champs (team)", value: bestText, inline: false },
      { name: "Worst champs (team)", value: worstText, inline: false },

      { name: "Tough enemy champs (lowest WR)", value: enemyWorstText, inline: false }
    )
    .setTimestamp();

  // public output
  await interaction.reply({ embeds: [embed] });
}