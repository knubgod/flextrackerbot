import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('record')
  .setDescription('Show stacked Flex win/loss record (auto + manual + total).');

export async function execute(interaction, ctx) {
  const rec = ctx.getTeamStackRecord();

  const embed = new EmbedBuilder()
    .setTitle('Stacked Flex Record')
    .addFields(
      { name: 'Auto (bot detected)', value: `**${rec.auto.wins}-${rec.auto.losses}**`, inline: true },
      { name: 'Manual', value: `**${rec.manual.wins}-${rec.manual.losses}**`, inline: true },
      { name: 'Total', value: `**${rec.total.wins}-${rec.total.losses}**`, inline: true }
    )
    .setFooter({ text: 'Auto = only games detected live by the bot (3+ stack in Flex).' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
