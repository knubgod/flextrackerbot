import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('roster')
  .setDescription('Manage roster players (add/remove/list).')
  .addSubcommand(sub =>
    sub.setName('add')
      .setDescription('Add a Riot ID to the roster.')
      .addStringOption(o => o.setName('gamename').setDescription('Riot gameName (before #)').setRequired(true))
      .addStringOption(o => o.setName('tagline').setDescription('Riot tagline (after #, e.g. NA1)').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('remove')
      .setDescription('Remove a Riot ID from the roster.')
      .addStringOption(o => o.setName('gamename').setDescription('Riot gameName (before #)').setRequired(true))
      .addStringOption(o => o.setName('tagline').setDescription('Riot tagline (after #)').setRequired(true))
  )
  .addSubcommand(sub =>
    sub.setName('list')
      .setDescription('List roster Riot IDs currently tracked.')
  );

export async function execute(interaction, ctx) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const roster = ctx.listRosterFromDb();
    const embed = new EmbedBuilder()
      .setTitle('Roster')
      .setDescription(roster.length ? roster.map(r => `• ${r.riot_display}`).join('\n') : 'No players on roster yet.')
      .setFooter({ text: 'Roster is used to detect 3+ stacked Flex games.' });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  const gameName = interaction.options.getString('gamename', true).trim();
  const tagLine = interaction.options.getString('tagline', true).trim();

  if (sub === 'add') {
    await interaction.reply({ content: `Adding **${gameName}#${tagLine}**…`, ephemeral: true });

    const puuid = await ctx.riotIdToPuuid(gameName, tagLine);
    if (!puuid) {
      return interaction.followUp({ content: `Could not find Riot ID: **${gameName}#${tagLine}**`, ephemeral: true });
    }

    ctx.addRosterPlayerToDb(gameName, tagLine, puuid);
    return interaction.followUp({ content: `Added **${gameName}#${tagLine}** to roster.`, ephemeral: true });
  }

  if (sub === 'remove') {
    ctx.removeRosterPlayerFromDb(gameName, tagLine);
    return interaction.reply({ content: `Removed **${gameName}#${tagLine}** from roster.`, ephemeral: true });
  }
}
