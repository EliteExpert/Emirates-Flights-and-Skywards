const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');

const STATUSES = [
  'Check-in Open', 'Boarding', 'Final Call', 'Gate Closed',
  'Delayed', 'Cancelled', 'Departed', 'In Flight', 'Arrived'
];

const AIRLINES = ['Emirates', 'Etihad Airways', 'Qatar Airways'];
const SESSION_TTL_MS = 10 * 60 * 1000;

function weeklyFlightEmbed() {
  return new EmbedBuilder()
    .setTitle('Weekly Flight Schedule — Submissions Open')
    .setDescription('The weekly flight schedule is ready for submissions.\n\nUse **/add-flight** to add a departure or arrival.')
    .addFields(
      { name: 'Submission window', value: 'Open now', inline: true },
      { name: 'Time standard', value: 'GMT / UTC', inline: true },
      { name: 'Flight entry', value: '`/add-flight`', inline: true }
    )
    .setFooter({ text: 'Emirates Flight Operations' })
    .setTimestamp();
}

function weeklyFlightListing(flights) {
  const sorted = [...flights].sort((a, b) => {
    const ad = `${a.date}T${a.departureTime || a.arrivalTime || '00:00'}:00Z`;
    const bd = `${b.date}T${b.departureTime || b.arrivalTime || '00:00'}:00Z`;
    return ad.localeCompare(bd);
  });

  if (!sorted.length) {
    return {
      embeds: [new EmbedBuilder()
        .setTitle('Weekly Flight Schedule')
        .setDescription('No flights are currently scheduled for this week.')
        .setFooter({ text: 'Emirates Flight Operations' })
        .setTimestamp()],
      components: []
    };
  }

  const messages = [];
  let current = [];
  let rows = [];

  const flush = () => {
    if (!current.length) return;
    messages.push({
      embeds: [new EmbedBuilder()
        .setTitle('Emirates PTFS — Weekly Flight Schedule')
        .setDescription(current.join('\n\n'))
        .setFooter({ text: 'Times are GMT / UTC · Emirates Flight Operations' })
        .setTimestamp()],
      components: rows
    });
    current = [];
    rows = [];
  };

  for (const flight of sorted) {
    const time = flight.departureTime || flight.arrivalTime || '--:--';
    const direction = flight.type === 'departure' ? 'DEP' : 'ARR';
    const routeLabel = flight.type === 'departure' ? '→' : '←';
    const eventUrl = typeof flight.discordEvent === 'string' ? flight.discordEvent.trim() : '';
    const line = `**${flight.flightNumber}** · ${flight.airline} · ${flight.date} · **${time} GMT**\n${direction} ${routeLabel} ${flight.destination} · ${flight.aircraft} · T${String(flight.terminal).replace(/^T/i, '')} · **${flight.status}**`;

    if (current.length >= 10 || [...current, line].join('\n\n').length > 3800) flush();
    current.push(line);

    if (eventUrl && /^https:\/\/discord(?:app)?\.com\//i.test(eventUrl)) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel(`${flight.flightNumber} Event`).setStyle(ButtonStyle.Link).setURL(eventUrl)
      ));
      if (rows.length >= 5) flush();
    }
  }
  flush();

  return messages;
}

function flightTypeRows() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('add-flight:type:departure').setLabel('Departure').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('add-flight:type:arrival').setLabel('Arrival').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('add-flight:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  )];
}

function airlineRows() {
  return [new ActionRowBuilder().addComponents(
    ...AIRLINES.map((airline) => new ButtonBuilder()
      .setCustomId(`add-flight:airline:${airline.toLowerCase().replace(/\s+/g, '-')}`)
      .setLabel(airline)
      .setStyle(ButtonStyle.Secondary)),
    new ButtonBuilder().setCustomId('add-flight:airline:other').setLabel('Other').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('add-flight:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  )];
}

function statusRow() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('add-flight:status')
    .setPlaceholder('Select the flight status')
    .addOptions(STATUSES.map((status) => new StringSelectMenuOptionBuilder().setLabel(status).setValue(status)));
  return [new ActionRowBuilder().addComponents(menu)];
}

function makeSession(userId) {
  return { userId, createdAt: Date.now(), flightType: null, date: null, airline: null, status: null };
}

function getSession(sessions, userId) {
  const session = sessions.get(userId);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(userId);
    return null;
  }
  return session;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function dateModal() {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  return new ModalBuilder()
    .setCustomId('add-flight:date')
    .setTitle('Flight Date')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('date')
        .setLabel('Date (YYYY-MM-DD)')
        .setPlaceholder('2026-09-13')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10)
    ));
}

function airlineModal() {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  return new ModalBuilder()
    .setCustomId('add-flight:airline-other')
    .setTitle('Other Airline')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('airline')
        .setLabel('Airline name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)
    ));
}

function detailsModal() {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const fields = [
    ['flightNumber', 'Flight Number', 'EK247', 20],
    ['scheduledTime', 'Scheduled Time (GMT, HH:MM)', '19:30', 5],
    ['route', 'Destination / Origin', 'London Heathrow (LHR)', 140],
    ['aircraft', 'Aircraft', 'A350-900', 80],
    ['terminal', 'Terminal', 'T3', 20]
  ];
  return new ModalBuilder()
    .setCustomId('add-flight:details')
    .setTitle('Flight Details')
    .addComponents(fields.map(([id, label, placeholder, maxLength]) => new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(maxLength)
    )));
}

function confirmationEmbed(flight) {
  const time = flight.departureTime || flight.arrivalTime;
  return new EmbedBuilder()
    .setTitle('Flight Added to FIDS')
    .setDescription('The flight has been successfully submitted through the FIDS API.')
    .addFields(
      { name: 'Flight', value: flight.flightNumber, inline: true },
      { name: 'Type', value: flight.type === 'departure' ? 'Departure' : 'Arrival', inline: true },
      { name: 'Date', value: flight.date, inline: true },
      { name: 'Airline', value: flight.airline, inline: true },
      { name: 'Status', value: flight.status, inline: true },
      { name: 'Scheduled', value: `${time} GMT`, inline: true },
      { name: flight.type === 'departure' ? 'Destination' : 'Origin', value: flight.destination, inline: true },
      { name: 'Aircraft', value: flight.aircraft, inline: true },
      { name: 'Terminal', value: flight.terminal, inline: true }
    )
    .setFooter({ text: 'Emirates Flight Operations' })
    .setTimestamp();
}

module.exports = {
  STATUSES,
  SESSION_TTL_MS,
  weeklyFlightEmbed,
  weeklyFlightListing,
  flightTypeRows,
  airlineRows,
  statusRow,
  makeSession,
  getSession,
  validDate,
  validTime,
  dateModal,
  airlineModal,
  detailsModal,
  confirmationEmbed
};
