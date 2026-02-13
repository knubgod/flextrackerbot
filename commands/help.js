import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show available commands and what they do.");

export async function execute(interaction, ctx) {
  const isAdmin =
    interaction.memberPermissions?.has("Administrator") ||
    (process.env.OWNER_USER_ID && interaction.user?.id === process.env.OWNER_USER_ID);

  const publicCmds = [
    { name: "/help", desc: "Show this help message." },
    { name: "/status", desc: "Show bot status + last poll times/errors." },
    { name: "/record", desc: "Show stack win/loss record (auto/manual/total)." },
    { name: "/roster list", desc: "List roster members." },
    { name: "/stats", desc: "Quick stats summary (needs match data to exist)." },
    { name: "/statsfive", desc: "5-stack-only stats (stack size must be 5)." },
  ];

  const adminCmds = [
    { name: "/config set alert-channel", desc: "Set where alerts/results are posted." },
    { name: "/config set threshold", desc: "Minimum stack size to detect (default 3)." },
    { name: "/config set poll-ms", desc: "Polling interval in ms (be kind to rate limits)." },
    { name: "/config set active-guild", desc: "Select which server config is active." },
    { name: "/roster add", desc: "Add a player to the roster by Riot ID." },
    { name: "/roster remove", desc: "Remove a player from the roster." },
    { name: "/recordadd", desc: "Add manual wins/losses (for games bot missed)." },
    { name: "/recordset", desc: "Set manual wins/losses directly." },
    { name: "/forcecheck", desc: "Run one poll immediately (debug/testing)." },
  ];

  const fmt = (rows) => rows.map((c) => `• **${c.name}** — ${c.desc}`).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Flex Tracker — Commands")
    .setDescription(
      "Most commands work immediately. Stats commands improve as you record more matches."
    )
    .addFields(
      { name: "Public commands", value: fmt(publicCmds) || "None", inline: false },
      {
        name: "Admin-only commands",
        value: isAdmin ? fmt(adminCmds) : "Admins only. (You don’t have access in this server.)",
        inline: false,
      }
    )
    .setFooter({ text: "Tip: /status helps troubleshoot when something stops responding." })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], ephemeral: true });
}