import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

function fmtAgo(ms) {
  if (ms == null) return 'Never';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function fmtUptime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}h ${m}m ${r}s`;
}

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show bot health, config, and record.');

export async function execute(interaction, ctx) {
  const cfg = ctx.getEffectiveConfig();
  const rec = ctx.getTeamStackRecord();

  const now = Date.now();
  const lastStart = ctx.getLastPollStartedAt?.();
  const lastOk = ctx.getLastPollFinishedAt?.();
  const lastErr = ctx.getLastPollError?.();

  const embed = new EmbedBuilder()
    .setTitle('Clash Tracker — Status')
    .addFields(
      { name: 'Uptime', value: fmtUptime(process.uptime()), inline: true },
      { name: 'Polling', value: `${Math.round(cfg.pollMs / 1000)}s`, inline: true },
      { name: 'Threshold', value: String(cfg.threshold), inline: true },

      { name: 'Alert Channel', value: cfg.alertChannelId ? `<#${cfg.alertChannelId}>` : 'Not set', inline: false },
      { name: 'Active Guild', value: cfg.activeGuildId ?? 'Not set', inline: false },

      { name: 'Last poll started', value: lastStart ? fmtAgo(now - lastStart) : 'Never', inline: true },
      { name: 'Last poll finished', value: lastOk ? fmtAgo(now - lastOk) : 'Never', inline: true },
      { name: 'Last poll error', value: lastErr ? lastErr : 'None', inline: false },

      { name: 'Record (Total)', value: `**${rec.total.wins}-${rec.total.losses}**`, inline: true },
      { name: 'Record (Auto)', value: `${rec.auto.wins}-${rec.auto.losses}`, inline: true },
      { name: 'Record (Manual)', value: `${rec.manual.wins}-${rec.manual.losses}`, inline: true },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
