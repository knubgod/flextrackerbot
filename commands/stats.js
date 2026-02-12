import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Show stack stats (overall, 5-stack, side WR, and tough enemy champs).");

export async function execute(interaction, ctx) {
  const db = ctx.db;
  if (!db) {
    return interaction.reply({ content: "Stats database not available (ctx.db missing).", ephemeral: true });
  }

  // Overall record (auto+manual)
  const record = ctx.getTeamStackRecord ? ctx.getTeamStackRecord() : null;
  const overallWins = record?.total?.wins ?? 0;
  const overallLosses = record?.total?.losses ?? 0;

  // 5-stack record
  const five = db
    .prepare(`
      SELECT
        SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
      FROM stack_matches
      WHERE win IS NOT NULL AND stack_size = 5
    `)
    .get();

  const fiveWins = five?.wins || 0;
  const fiveLosses = five?.losses || 0;

  // Side record (BLUE/RED)
  const sides = db
    .prepare(`
      SELECT side,
        SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
      FROM stack_matches
      WHERE win IS NOT NULL AND side IS NOT NULL
      GROUP BY side
    `)
    .all();

  const sideMap = new Map();
  for (const r of sides) sideMap.set(r.side, r);

  const blue = sideMap.get("BLUE") || { wins: 0, losses: 0 };
  const red = sideMap.get("RED") || { wins: 0, losses: 0 };

  // Worst vs enemy champs
  const MIN_GAMES = 3;
  const LIMIT = 8;

  const worst = db
    .prepare(`
      SELECT champ,
        COUNT(*) AS games,
        SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN win = 0 THEN 1 ELSE 0 END) AS losses
      FROM enemy_champ_results
      GROUP BY champ
      HAVING COUNT(*) >= ?
      ORDER BY (CAST(SUM(CASE WHEN win = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) ASC
      LIMIT ?
    `)
    .all(MIN_GAMES, LIMIT);

  const worstLines =
    worst.length === 0
      ? [`Not enough data yet (need at least ${MIN_GAMES} games vs a champ).`]
      : worst.map((r) => {
          const wr = r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0;
          return `• **${r.champ}** — ${r.wins}-${r.losses} (${wr}% WR, ${r.games} games)`;
        });

  const embed = new EmbedBuilder()
    .setTitle("Flex Tracker — Team Stats")
    .addFields(
      { name: "Overall record", value: `**${overallWins}-${overallLosses}**`, inline: true },
      { name: "5-stack record", value: `**${fiveWins}-${fiveLosses}**`, inline: true },
      {
        name: "Side record",
        value: `Blue: **${blue.wins || 0}-${blue.losses || 0}**\nRed: **${red.wins || 0}-${red.losses || 0}**`,
        inline: true,
      },
      { name: "Tough enemy champs (lowest WR)", value: worstLines.join("\n"), inline: false }
    )
    .setTimestamp();

  // Public reply (visible to everyone)
  await interaction.reply({ embeds: [embed] });
}