const { MessageFlags } = require('discord.js');
const { listFlights, weeklyFlights } = require('../api');
const { flightListingMessage, weeklyAnnouncementMessages } = require('../flight-ui');

const data = {
  name: 'flights',
  description: 'View the current flight schedule.',
  options: [
    { name: 'week', description: 'Show this Sunday-to-Saturday UTC week.', type: 5 },
    { name: 'date', description: 'Show flights for a specific UTC date.', type: 3, required: false },
    { name: 'type', description: 'Filter by departure or arrival.', type: 3, required: false,
      choices: [{ name: 'Departures', value: 'departure' }, { name: 'Arrivals', value: 'arrival' }] }
  ]
};

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const date = interaction.options.getString('date');
    const type = interaction.options.getString('type');
    const week = interaction.options.getBoolean('week');
    const isWeekly = week || (!date && !type);

    if (isWeekly) {
      const summary = await weeklyFlights();
      const announcement = weeklyAnnouncementMessages(summary.flights, summary.weekStart);
      const [first, ...rest] = announcement.messages;
      await interaction.editReply(first);
      for (const payload of rest) {
        await interaction.followUp({ ...payload, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      }
      return;
    }

    let flights = await listFlights();
    if (date) flights = flights.filter((flight) => flight.date === date);
    if (type) flights = flights.filter((flight) => flight.type === type);

    await interaction.editReply(flightListingMessage(flights, date ? `Emirates PTFS Flights — ${date}` : 'Emirates PTFS Flight Schedule')); 
  } catch (error) {
    console.error('[Discord] /flights failed:', error);
    return interaction.editReply({ content: 'I could not retrieve the flight schedule right now.' });
  }
}

module.exports = { data, execute };
