const { PermissionFlagsBits } = require('discord.js');

const data = {
  name: 'weekly-flight',
  description: 'Publish the current weekly flight schedule.',
  default_member_permissions: PermissionFlagsBits.ManageGuild.toString()
};

async function execute(interaction, { config, postWeeklyMessage }) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server permission to use this command.', ephemeral: true });
  if (interaction.channelId !== config.weeklyFlightChannelId) return interaction.reply({ content: 'This command can only be used in the configured flight channel.', ephemeral: true });
  try {
    await postWeeklyMessage(interaction.channel);
    return interaction.reply({ content: 'The current flight schedule has been published.', ephemeral: true });
  } catch (error) {
    console.error('[Discord] /weekly-flight failed:', error);
    return interaction.reply({ content: 'I could not publish the flight schedule right now.', ephemeral: true });
  }
}

module.exports = { data, execute };
