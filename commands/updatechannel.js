import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("updateschannel")
  .setDescription("Admin: set/clear the bot-updates channel for GitHub release notifications.")
  .addSubcommand((s) =>
    s
      .setName("set")
      .setDescription("Set the channel where GitHub release updates are posted.")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("The bot-updates channel").setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s.setName("clear").setDescription("Stop posting GitHub release updates in this server.")
  );

export async function execute(interaction, ctx) {
  if (!ctx.canEditRecord(interaction)) {
    return interaction.reply({ content: "Not allowed. (Admins or bot owner only.)", ephemeral: true });
  }

  const guildId = interaction.guildId;
  if (!guildId) return interaction.reply({ content: "This command must be used in a server.", ephemeral: true });

  const sub = interaction.options.getSubcommand();

  if (sub === "set") {
    const ch = interaction.options.getChannel("channel", true);
    if (!ch?.isTextBased()) {
      return interaction.reply({ content: "Please pick a text channel.", ephemeral: true });
    }

    ctx.upsertGuildConfig({ guildId, updatesChannelId: ch.id });
    // Optional: set active guild automatically if not set
    const g = ctx.getGlobalConfig();
    if (!g?.active_guild_id) ctx.setGlobalConfigActiveGuild(guildId);

    return interaction.reply({ content: `✅ Bot update channel set to <#${ch.id}>`, ephemeral: true });
  }

  // clear
  ctx.upsertGuildConfig({ guildId, updatesChannelId: "" });
  return interaction.reply({ content: "✅ Bot update channel cleared (no more GitHub release posts).", ephemeral: true });
}