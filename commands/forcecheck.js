import { SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('forcecheck')
  .setDescription('Run a roster check right now (manual poll).');

export async function execute(interaction, ctx) {
  await interaction.reply({ content: 'Running a check now…', ephemeral: true });

  try {
    await ctx.pollOnce();
    // You’ll see output in the terminal; alerts still post to the channel normally.
    await interaction.followUp({ content: 'Check complete. (Watch the terminal / alerts channel.)', ephemeral: true });
  } catch (e) {
    await interaction.followUp({ content: `Check failed: ${e.message}`, ephemeral: true });
  }
}
