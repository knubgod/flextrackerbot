import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('recordadd')
  .setDescription('Add to the manual W/L record (for games played while bot was down).')
  .addIntegerOption(o => o.setName('wins').setDescription('Wins to add').setRequired(true).setMinValue(0))
  .addIntegerOption(o => o.setName('losses').setDescription('Losses to add').setRequired(true).setMinValue(0));

export async function execute(interaction, ctx) {
    if (!ctx.canEditRecord(interaction)) {
    return interaction.reply({ content: 'Not allowed. (Admins or bot owner only.)', ephemeral: true });
  }

  const wins = interaction.options.getInteger('wins', true);
  const losses = interaction.options.getInteger('losses', true);

  ctx.addManualRecord(wins, losses);
  const rec = ctx.getTeamStackRecord();

  await interaction.reply({
    content: `Manual record updated. Total is now **${rec.total.wins}-${rec.total.losses}** (Auto ${rec.auto.wins}-${rec.auto.losses}, Manual ${rec.manual.wins}-${rec.manual.losses}).`,
    ephemeral: true
  });
}
