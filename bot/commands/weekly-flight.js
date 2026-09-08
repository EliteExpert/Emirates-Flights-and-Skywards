const { PermissionFlagsBits } = require('discord.js');
const { weeklyFlightEmbed } = require('../flight-ui');

const data = {
  name: 'weekly-flight',
  description: 'Open the weekly flight submission schedule.',
  default_member_permissions: PermissionFlagsBits.ManageGuild.toString()
};

async function execute(interaction, { config, postWeeklyMessage }) {
  if (interaction.channelId !== config.weeklyFlightChannelId) {
    return interaction.reply({ content: 'This command can only be used in the configured weekly flight channel.', ephemeral: true });
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'You need Manage Server permission to use this command.', ephemeral: true });
  }

  try {
    await postWeeklyMessage(interaction.channel);
    return interaction.reply({ content: 'The weekly flight submission message has been posted.', ephemeral: true });
  } catch (error) {
    console.error('[Discord] /weekly-flight failed:', error);
    return interaction.reply({ content: 'I could not post the weekly flight message. Check the bot channel permissions and server logs.', ephemeral: true });
  }
}

module.exports = { data, execute };
