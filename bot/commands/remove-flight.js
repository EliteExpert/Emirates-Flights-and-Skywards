const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { listFlights, removeFlight } = require('../api');

const data = {
  name: 'remove-flight',
  description: 'Remove an existing flight from the schedule.',
  default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
  options: [
    { name: 'type', description: 'Departure or arrival.', type: 3, required: true, choices: [{ name: 'Departure', value: 'departure' }, { name: 'Arrival', value: 'arrival' }] },
    { name: 'date', description: 'Flight date in YYYY-MM-DD.', type: 3, required: true },
    { name: 'flight-number', description: 'Flight number, e.g. EK247.', type: 3, required: true }
  ]
};

async function execute(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server permission to remove flights.', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const identity = { type: interaction.options.getString('type'), date: interaction.options.getString('date'), flightNumber: interaction.options.getString('flight-number').trim().toUpperCase() };
  try {
    const flights = await listFlights();
    const existing = flights.find((f) => f.type === identity.type && f.date === identity.date && String(f.flightNumber).toUpperCase() === identity.flightNumber);
    await removeFlight(identity);
    if (existing?.discordEvent) {
      const match = String(existing.discordEvent).match(/\/events\/[^/]+\/(\d+)$/);
      if (match) await interaction.client.guilds.fetch(interaction.guildId).then((g) => g.scheduledEvents.delete(match[1]).catch(() => {})).catch(() => {});
    }
    return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('Flight Removed').setDescription(`**${identity.flightNumber}** on **${identity.date}** has been removed from the schedule.`).setTimestamp()] });
  } catch (error) {
    console.error('[Discord] /remove-flight failed:', error);
    return interaction.editReply({ content: error.status === 404 ? 'That flight could not be found.' : 'I could not remove that flight.' });
  }
}
module.exports = { data, execute };
