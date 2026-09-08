const { listFlights, weeklySummary } = require('../api');
const { weeklySummaryMessage, weeklyFlightListing } = require('../flight-ui');

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

function weekBounds() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

function filterFlights(flights, interaction) {
  const date = interaction.options.getString('date');
  const type = interaction.options.getString('type');
  const week = interaction.options.getBoolean('week');
  let result = flights;
  if (week || (!date && !type)) {
    const [start, end] = weekBounds();
    result = result.filter((f) => f.date >= start && f.date <= end);
  }
  if (date) result = result.filter((f) => f.date === date);
  if (type) result = result.filter((f) => f.type === type);
  return result;
}

async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const date = interaction.options.getString('date');
    const type = interaction.options.getString('type');
    const week = interaction.options.getBoolean('week');
    const isWeekly = week || (!date && !type);

    if (isWeekly) {
      // server.js owns the weekly definition: current Sunday through Saturday, GMT/UTC.
      const summary = await weeklySummary();
      return interaction.editReply(weeklySummaryMessage(summary));
    }

    const flights = filterFlights(await listFlights(), interaction);
    const messages = weeklyFlightListing(flights);
    const label = date || (type === 'departure' ? 'Departures' : 'Arrivals');

    if (messages.length === 1) {
      return interaction.editReply({ content: `**${label}**`, ...messages[0] });
    }
    await interaction.editReply({ content: `**${label}**`, ...messages[0] });
    for (const message of messages.slice(1)) {
      await interaction.followUp({ ...message, ephemeral: true });
    }
  } catch (error) {
    console.error('[Discord] /flights failed:', error);
    return interaction.editReply({ content: 'I could not retrieve the flight schedule right now.' });
  }
}

module.exports = { data, execute };
