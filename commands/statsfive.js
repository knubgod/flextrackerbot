import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

const MIN_GAMES_DEFAULT = 3;
const LIMIT = 8;

export const data = new SlashCommandBuilder()
  .setName("statsfive")
  .setDescription("Stats filtered to FULL 5-stacks only (stack_size = 5).")
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

  // 5-stack overall record
  const rec = db.prepare(`
    SELECT
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM stack_matches
    WHERE win IS NOT NULL AND stack_size = 5
  `).get();

  const wins = rec?.wins || 0;
  const losses = rec?.losses || 0;
  const recordText = (wins + losses) === 0 ? "No 5-stack matches recorded yet." : `**${wins}-${losses}**`;

  // Side record (5-stacks only)
  const sides = db.prepare(`
    SELECT side,
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM stack_matches
    WHERE win IS NOT NULL AND side IS NOT NULL AND stack_size = 5
    GROUP BY side
  `).all();

  const sideMap = new Map(sides.map(r => [r.side, r]));
  const blue = sideMap.get("BLUE") || { wins: 0, losses: 0 };
  const red = sideMap.get("RED") || { wins: 0, losses: 0 };

  const sideText =
    ((blue.wins + blue.losses + red.wins + red.losses) === 0)
      ? "No 5-stack side data recorded yet."
      : `Blue: **${blue.wins}-${blue.losses}**\nRed: **${red.wins}-${red.losses}**`;

  // Team champ performance (5-stacks only)
  const fmtChampLine = (r) => {
    const wr = r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0;
    return `• **${r.champ}** — ${r.wins}-${r.losses} (${wr}% WR, ${r.games})`;
  };

  const mostPlayed = db.prepare(`
    SELECT champ, COUNT(*) AS games,
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM team_champ_results
    WHERE stack_size = 5
    GROUP BY champ
    ORDER BY games DESC
    LIMIT ?
  `).all(LIMIT);

  const best = db.prepare(`
    SELECT champ, COUNT(*) AS games,
      SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
    FROM team_champ_results
    WHERE stack_size = 5
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
    WHERE stack_size = 5
    GROUP BY champ
    HAVING COUNT(*) >= ?
    ORDER BY (CAST(SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) ASC
    LIMIT ?
  `).all(MIN_GAMES, LIMIT);

  const mostPlayedText = mostPlayed.length
    ? mostPlayed.map(fmtChampLine).join("\n")
    : "No 5-stack team champ data yet.";

  const bestText = best.length
    ? best.map(fmtChampLine).join("\n")
    : `Not enough data yet (need ${MIN_GAMES}+ 5-stack games on a champ).`;

  const worstText = worst.length
    ? worst.map(fmtChampLine).join("\n")
    : `Not enough data yet (need ${MIN_GAMES}+ 5-stack games on a champ).`;

  // Enemy champ struggles (5-stacks only)
  const enemyWorst = db.prepare(`
    SELECT e.champ,
      COUNT(*) AS games,
      SUM(CASE WHEN e.win = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN e.win = 0 THEN 1 ELSE 0 END) AS losses
    FROM enemy_champ_results e
    JOIN stack_matches s ON s.match_id = e.match_id
    WHERE s.stack_size = 5 AND s.win IS NOT NULL
    GROUP BY e.champ
    HAVING COUNT(*) >= ?
    ORDER BY (CAST(SUM(CASE WHEN e.win = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) ASC
    LIMIT ?
  `).all(MIN_GAMES, LIMIT);

  const enemyWorstText = enemyWorst.length
    ? enemyWorst.map(fmtChampLine).join("\n")
    : `Not enough data yet (need ${MIN_GAMES}+ 5-stack games vs a champ).`;

  const embed = new EmbedBuilder()
    .setTitle("Flex Tracker — 5-Stack Stats Only")
    .addFields(
      { name: "5-stack record", value: recordText, inline: true },
      { name: "Side record (5-stack)", value: sideText, inline: true },

      { name: "Most played champs (team, 5-stack)", value: mostPlayedText, inline: false },
      { name: "Best champs (team, 5-stack)", value: bestText, inline: false },
      { name: "Worst champs (team, 5-stack)", value: worstText, inline: false },

      { name: "Tough enemy champs (5-stack only)", value: enemyWorstText, inline: false }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}