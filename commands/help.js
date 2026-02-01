import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show what this bot can do and a list of commands.');

export async function execute(interaction, ctx) {
  const embed = new EmbedBuilder()
    .setTitle('Clash Tracker — Help')
    .setDescription(
      [
        '**What it does**',
        '• Detects when **3+ roster players** are stacked in **Ranked Flex (440)** on the same team.',
        '• Posts a detection message and a post-game result message in the configured alert channel.',
        '• Tracks an all-time win/loss record (auto + optional manual adjustments).',
        '',
        '**Commands**',
        '**Roster**',
        '• `/roster list`',
        '• `/roster add <gameName> <tagLine>`',
        '• `/roster remove <gameName> <tagLine>`',
        '',
        '**Record**',
        '• `/record`',
        '• `/recordadd <wins> <losses>` (admin/owner only)',
        '• `/recordset <wins> <losses>` (admin/owner only)',
        '',
        '**Checks**',
        '• `/forcecheck`',
        '',
        '**Config**',
        '• `/config show`',
        '• `/config set-alert-channel <channel>` (admin/owner only)',
        '• `/config set-threshold <number>` (admin/owner only)',
        '• `/config set-poll-seconds <seconds>` (admin/owner only)',
        '',
        '**Info**',
        '• `/status`',
        '• `/help`',
        '',
        '_Note: Some commands reply privately to the person who runs them (normal for slash commands)._',
      ].join('\n')
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
