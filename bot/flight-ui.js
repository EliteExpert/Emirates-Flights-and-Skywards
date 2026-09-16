const path = require('path');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder
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

function addGmtDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function currentGmtWeekStart() {
  const now = new Date();
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay()));
  return sunday.toISOString().slice(0, 10);
}

function flightListingMessage(flights, title = 'Emirates PTFS Flight Schedule') {
  const dateFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  const conciseDate = (date) => dateFormat.format(date).replace(',', '');
  const sorted = [...flights].sort((a, b) => {
    const at = `${a.date}T${a.departureTime || a.arrivalTime || '00:00'}:00Z`;
    const bt = `${b.date}T${b.departureTime || b.arrivalTime || '00:00'}:00Z`;
    return at.localeCompare(bt);
  });

  const body = sorted.length
    ? sorted.map((flight) => {
        const time = flight.departureTime || flight.arrivalTime || '--:--';
        const type = flight.type === 'departure' ? 'DEP' : 'ARR';
        const eventUrl = typeof flight.discordEvent === 'string' ? flight.discordEvent.trim() : '';
        const eventLink = /^https:\/\/discord(?:app)?\.com\//i.test(eventUrl)
          ? ` · [Event ↗](${eventUrl})`
          : '';
        return `• ${conciseDate(new Date(`${flight.date}T00:00:00Z`))} · **${time} GMT** · ${flight.flightNumber} · ${flight.destination} (${type})${eventLink}`;
      }).join('\n────────────────────────\n')
    : 'No flights match the selected filters.';

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${title}**`));
  // Text displays cap at 4000 characters; split long schedules across several.
  for (let offset = 0; offset < body.length; offset += 3900) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body.slice(offset, offset + 3900)));
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}

// Discord caps Components V2 messages at 40 components (nested ones included).
// With the header/footer galleries and per-flight text+separator pairs, 15
// flights per message keeps every part at 35 components or fewer.
const MAX_FLIGHTS_PER_ANNOUNCEMENT = 15;

function weeklyAnnouncementContainer(flights, weekStart, boardUrl, partLabel) {
  const dateFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
  const conciseDate = (date) => dateFormat.format(date).replace(',', '');
  const sorted = [...flights].sort((a, b) => {
    const at = `${a.date}T${a.departureTime || a.arrivalTime || '00:00'}:00Z`;
    const bt = `${b.date}T${b.departureTime || b.arrivalTime || '00:00'}:00Z`;
    return at.localeCompare(bt);
  });

  const headerText = [
    '**<:EKcrest:1315380870965624995> Emirates PTFS Weekly Flight Schedule**',
    `> **${conciseDate(new Date(`${weekStart}T00:00:00Z`))} – ${conciseDate(new Date(`${addGmtDays(weekStart, 6)}T00:00:00Z`))}**`,
    ...(partLabel ? [`-# ${partLabel}`] : [])
  ].join('\n');

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));

  if (!sorted.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('No flights are currently scheduled for this week.')
    );
  } else {
    for (let index = 0; index < sorted.length; index += 1) {
      const flight = sorted[index];
      const time = flight.departureTime || flight.arrivalTime || '--:--';
      const type = flight.type === 'departure' ? 'DEP' : 'ARR';
      const eventUrl = typeof flight.discordEvent === 'string' ? flight.discordEvent.trim() : '';
      const safeEventUrl = /^https:\/\/discord(?:app)?\.com\//i.test(eventUrl) ? eventUrl : '';
      const eventLink = safeEventUrl ? ` · **[Event link ↗](${safeEventUrl})**` : '';
      const flightText = `• ${conciseDate(new Date(`${flight.date}T00:00:00Z`))} · **${time} GMT** · ${flight.flightNumber} · ${flight.destination} (${type})${eventLink}`;
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(flightText));

      // Each flight is its own TextDisplay so native Components V2 separators can sit between them.
      if (index < sorted.length - 1) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
      }
    }
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**[View the live board in the FIDS ↗](${boardUrl})**\n-# <:Emiratesnewtail:1480910652427079680> **Fly Emirates** <@&1295727684806115328>`
    )
  );
  return container;
}

function weeklyAnnouncementMessages(flights, weekStart = currentGmtWeekStart(), boardUrl = 'https://emirates-ptfs-fids.onrender.com/departures') {
  const sorted = [...flights];
  const chunks = [];
  for (let offset = 0; offset < sorted.length || offset === 0; offset += MAX_FLIGHTS_PER_ANNOUNCEMENT) {
    chunks.push(sorted.slice(offset, offset + MAX_FLIGHTS_PER_ANNOUNCEMENT));
    if (offset + MAX_FLIGHTS_PER_ANNOUNCEMENT >= sorted.length) break;
  }
  const totalParts = chunks.length;

  const headerImagePath = path.join(__dirname, '..', 'public', 'weekly-header.png');
  const footerImagePath = path.join(__dirname, '..', 'public', 'weekly-footer.png');

  const messages = chunks.map((chunk, partIndex) => {
    const partLabel = totalParts > 1 ? `Part ${partIndex + 1} of ${totalParts}` : '';
    const container = weeklyAnnouncementContainer(chunk, weekStart, boardUrl, partLabel);
    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components: [container]
    };
    // Attachments are per message, so only the first part carries the artwork.
    if (partIndex === 0) {
      const header = new MediaGalleryBuilder().addItems({
        media: { url: 'attachment://weekly-header.png' },
        description: 'Emirates PTFS Weekly Flights'
      });
      const footer = new MediaGalleryBuilder().addItems({
        media: { url: 'attachment://weekly-footer.png' },
        description: 'Fly Better'
      });
      payload.components = [header, container, footer];
      payload.files = [
        { attachment: headerImagePath, name: 'weekly-header.png' },
        { attachment: footerImagePath, name: 'weekly-footer.png' }
      ];
    }
    return payload;
  });

  return { messages };
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
  flightListingMessage,
  weeklyAnnouncementMessages,
  MAX_FLIGHTS_PER_ANNOUNCEMENT,
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
