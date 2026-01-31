import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure bot settings for this server.")
  .addSubcommand(sub =>
    sub.setName("show")
      .setDescription("Show current configuration.")
  )
  .addSubcommand(sub =>
    sub.setName("set-alert-channel")
      .setDescription("Set the channel where the bot posts stack alerts.")
      .addChannelOption(opt =>
        opt.setName("channel")
          .setDescription("Alert channel")
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      )
  )
  .addSubcommand(sub =>
    sub.setName("set-threshold")
      .setDescription("Set how many roster players must be stacked to trigger alerts.")
      .addIntegerOption(opt =>
        opt.setName("count")
          .setDescription("Stack threshold (e.g., 3)")
          .setRequired(true)
          .setMinValue(2)
          .setMaxValue(5)
      )
  )
  .addSubcommand(sub =>
    sub.setName("set-poll-seconds")
      .setDescription("Set how often the bot checks for games (seconds).")
      .addIntegerOption(opt =>
        opt.setName("seconds")
          .setDescription("Polling interval in seconds (15–300 recommended)")
          .setRequired(true)
          .setMinValue(15)
          .setMaxValue(300)
      )
  );

export async function execute(interaction, ctx) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (!guildId) {
    return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
  }

  // Only admins or owner
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  const isOwner = process.env.OWNER_USER_ID && interaction.user.id === process.env.OWNER_USER_ID;
  const canEdit = Boolean(isAdmin || isOwner);

  if (sub === "show") {
    const global = ctx.getGlobalConfig();
    const guild = ctx.getGuildConfig(guildId);
    const effective = ctx.getEffectiveConfig();

    const embed = new EmbedBuilder()
      .setTitle("Bot Configuration")
      .addFields(
        { name: "Active server", value: global.active_guild_id ? `✅ set` : "❌ not set", inline: true },
        { name: "Poll interval", value: `${Math.round((global.poll_ms ?? 60000) / 1000)}s`, inline: true },
        { name: "Threshold", value: String(guild.threshold ?? 3), inline: true },
        { name: "Alert channel (this server)", value: guild.alert_channel_id ? `<#${guild.alert_channel_id}>` : "Not set", inline: false },
        { name: "Effective alert channel", value: effective.alertChannelId ? `<#${effective.alertChannelId}>` : "None", inline: false },
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (!canEdit) {
    return interaction.reply({ content: "Not allowed. (Admins or bot owner only.)", ephemeral: true });
  }

  // Make this guild the active one automatically when you configure it
  ctx.setGlobalConfigActiveGuild(guildId);

  if (sub === "set-alert-channel") {
    const channel = interaction.options.getChannel("channel", true);
    const current = ctx.getGuildConfig(guildId);

    ctx.upsertGuildConfig({
      guildId,
      alertChannelId: channel.id,
      threshold: current.threshold ?? 3
    });

    return interaction.reply({ content: `Alert channel set to ${channel}.`, ephemeral: true });
  }

  if (sub === "set-threshold") {
    const count = interaction.options.getInteger("count", true);
    const current = ctx.getGuildConfig(guildId);

    ctx.upsertGuildConfig({
      guildId,
      alertChannelId: current.alert_channel_id ?? null,
      threshold: count
    });

    return interaction.reply({ content: `Threshold set to **${count}**.`, ephemeral: true });
  }

  if (sub === "set-poll-seconds") {
    const seconds = interaction.options.getInteger("seconds", true);
    ctx.setGlobalPollMs(seconds * 1000);
    return interaction.reply({ content: `Poll interval set to **${seconds}s**.`, ephemeral: true });
  }
}
