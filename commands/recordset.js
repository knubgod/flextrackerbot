import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('recordset')
  .setDescription('Set the manual W/L record exactly.')
  .addIntegerOption(o => o.setName('wins').setDescription('Manual wins').setRequired(true).setMinValue(0))
  .addIntegerOption(o => o.setName('losses').setDescription('Manual losses').setRequired(true).setMinValue(0));

export async function execute(interaction, ctx) {
      if (!ctx.canEditRecord(interaction)) {
    return interaction.reply({ content: 'Not allowed. (Admins or bot owner only.)', ephemeral: true });
  }

  const wins = interaction.options.getInteger('wins', true);
  const losses = interaction.options.getInteger('losses', true);

  ctx.setManualRecord(wins, losses);
  const rec = ctx.getTeamStackRecord();

  await interaction.reply({
    content: `Manual record set. Total is now **${rec.total.wins}-${rec.total.losses}** (Auto ${rec.auto.wins}-${rec.auto.losses}, Manual ${rec.manual.wins}-${rec.manual.losses}).`,
    ephemeral: true
  });
}
