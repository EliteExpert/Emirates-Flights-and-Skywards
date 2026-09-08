const { listFlights, weeklyFlights } = require('../api');
const { weeklyFlightListing } = require('../flight-ui');

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
  await interaction.deferReply({ ephemeral: true });
  try {
    const date = interaction.options.getString('date');
    const type = interaction.options.getString('type');
    const week = interaction.options.getBoolean('week');
    const isWeekly = week || (!date && !type);

    if (isWeekly) {
      const summary = await weeklyFlights();
      const messages = weeklyFlightListing(summary.flights, summary.weekStart);
      await interaction.editReply(messages[0]);
      for (const message of messages.slice(1)) await interaction.followUp({ ...message, ephemeral: true });
      return;
    }

    let flights = await listFlights();
    if (date) flights = flights.filter((flight) => flight.date === date);
    if (type) flights = flights.filter((flight) => flight.type === type);

    const messages = weeklyFlightListing(flights, date || undefined);
    const label = date || (type === 'departure' ? 'Departures' : 'Arrivals');
    await interaction.editReply({ content: `**${label}**\n${messages[0].content}`, components: messages[0].components });
    for (const message of messages.slice(1)) await interaction.followUp({ ...message, ephemeral: true });
  } catch (error) {
    console.error('[Discord] /flights failed:', error);
    return interaction.editReply({ content: 'I could not retrieve the flight schedule right now.' });
  }
}

module.exports = { data, execute };
