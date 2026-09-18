const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { updateStatus } = require('../api');
const { STATUSES } = require('../flight-ui');

const data = {
  name: 'update-flight',
  description: 'Update the status of an existing flight.',
  default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
  options: [
    { name: 'type', description: 'Departure or arrival.', type: 3, required: true, choices: [{ name: 'Departure', value: 'departure' }, { name: 'Arrival', value: 'arrival' }] },
    { name: 'date', description: 'Flight date in YYYY-MM-DD.', type: 3, required: true },
    { name: 'flight-number', description: 'Flight number, e.g. EK247.', type: 3, required: true },
    { name: 'status', description: 'New flight status.', type: 3, required: true, choices: STATUSES.map((s) => ({ name: s, value: s })) }
  ]
};

async function execute(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server permission to update flights.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await updateStatus({
      type: interaction.options.getString('type'),
      date: interaction.options.getString('date'),
      flightNumber: interaction.options.getString('flight-number').trim().toUpperCase()
    }, interaction.options.getString('status'));
    const f = result.flight;
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('Flight Updated').setDescription(`**${f.flightNumber}** is now **${f.status}**.`).addFields({ name: 'Date', value: f.date, inline: true }, { name: 'Type', value: f.type, inline: true }).setTimestamp()] });
  } catch (error) {
    console.error('[Discord] /update-flight failed:', error);
    return interaction.editReply({ content: error.status === 404 ? 'That flight could not be found.' : 'I could not update that flight.' });
  }
}
module.exports = { data, execute };
