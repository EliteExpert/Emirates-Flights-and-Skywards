const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags
} = require('discord.js');

const {
  AIRLINES,
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
  ptfsRouteModal,
  confirmationEmbed
} = require('../flight-ui');

const data = { name: 'add-flight', description: 'Add a flight to the schedule.' };

function cancelReply() {
  return { content: 'Flight entry cancelled.', components: [], flags: MessageFlags.Ephemeral };
}

function sessionError(interaction) {
  return interaction.reply({ content: 'This flight-entry session has expired or is unavailable. Start again with `/add-flight`.', flags: MessageFlags.Ephemeral });
}

async function execute(interaction, { sessions }) {
  const existing = sessions.get(interaction.user.id);
  if (existing) sessions.delete(interaction.user.id);
  sessions.set(interaction.user.id, makeSession(interaction.user.id));

  return interaction.reply({
    content: 'Choose the flight type. Your entry session expires after 10 minutes.',
    components: flightTypeRows(),
    flags: MessageFlags.Ephemeral
  });
}

async function handleComponent(interaction, context) {
  const session = getSession(context.sessions, interaction.user.id);
  if (!session) return sessionError(interaction);
  if (session.userId !== interaction.user.id) return interaction.reply({ content: 'You cannot use another user\'s flight-entry session.', flags: MessageFlags.Ephemeral });

  const [, action, value] = interaction.customId.split(':');
  if (action === 'cancel') {
    context.sessions.delete(interaction.user.id);
    return interaction.update(cancelReply());
  }

  if (action === 'type') {
    session.flightType = value;
    return interaction.showModal(dateModal());
  }

  if (action === 'airline') {
    if (value === 'other') return interaction.showModal(airlineModal());
    // Buttons carry a slug of the airline name; an unmatched slug means the
    // message predates the current airline list.
    const airline = AIRLINES.find((name) => name.toLowerCase().replace(/\s+/g, '-') === value);
    if (!airline) {
      return interaction.reply({ content: 'That flight-entry control is no longer valid. Start again with `/add-flight`.', flags: MessageFlags.Ephemeral });
    }
    session.airline = airline;
    return interaction.update({ content: 'Select the flight status.', components: statusRow() });
  }

  if (action === 'status') {
    session.status = interaction.values[0];
    return interaction.showModal(detailsModal());
  }

  return interaction.reply({ content: 'That flight-entry control is no longer valid. Start again with `/add-flight`.', flags: MessageFlags.Ephemeral });
}

async function handleModal(interaction, context) {
  const session = getSession(context.sessions, interaction.user.id);
  if (!session) return sessionError(interaction);
  if (session.userId !== interaction.user.id) return interaction.reply({ content: 'You cannot use another user\'s flight-entry session.', flags: MessageFlags.Ephemeral });

  if (interaction.customId === 'add-flight:date') {
    const date = interaction.fields.getTextInputValue('date').trim();
    if (!validDate(date)) {
      return interaction.reply({ content: 'Invalid date. Use a real date in `YYYY-MM-DD` format, for example `2026-09-13`.', flags: MessageFlags.Ephemeral });
    }
    session.date = date;
    return interaction.reply({ content: 'Choose the airline.', components: airlineRows(), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'add-flight:airline-other') {
    const airline = interaction.fields.getTextInputValue('airline').trim();
    if (!airline) return interaction.reply({ content: 'Please provide an airline name.', flags: MessageFlags.Ephemeral });
    session.airline = airline;
    return interaction.reply({ content: 'Select the flight status.', components: statusRow(), flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'add-flight:details') {
    const flightNumber = interaction.fields.getTextInputValue('flightNumber').trim().toUpperCase();
    const scheduledTime = interaction.fields.getTextInputValue('scheduledTime').trim();
    const route = interaction.fields.getTextInputValue('route').trim();
    const aircraft = interaction.fields.getTextInputValue('aircraft').trim();
    const terminal = interaction.fields.getTextInputValue('terminal').trim().toUpperCase();

    if (!validTime(scheduledTime)) {
      return interaction.reply({ content: 'Invalid scheduled time. Use 24-hour `HH:MM` format, for example `19:30`.', flags: MessageFlags.Ephemeral });
    }

    session.flightNumber = flightNumber;
    session.scheduledTime = scheduledTime;
    session.route = route;
    session.aircraft = aircraft;
    session.terminal = terminal;
    return interaction.showModal(ptfsRouteModal());
  }

  if (interaction.customId === 'add-flight:ptfs-route') {
    const flightNumber = session.flightNumber;
    const scheduledTime = session.scheduledTime;
    const route = session.route;
    const aircraft = session.aircraft;
    const terminal = session.terminal;
    const ptfsDeparture = interaction.fields.getTextInputValue('ptfsDeparture').trim();
    const ptfsArrival = interaction.fields.getTextInputValue('ptfsArrival').trim();

    let createdEvent = null;
    try {
      const guild = await interaction.client.guilds.fetch(context.config.discordGuildId);
      const scheduledStart = new Date(`${session.date}T${scheduledTime}:00Z`);
      const scheduledEnd = new Date(scheduledStart.getTime() + 60 * 60 * 1000);
      if (scheduledStart.getTime() <= Date.now()) {
        return interaction.reply({ content: 'The scheduled time must be in the future so the Discord event can be created.', flags: MessageFlags.Ephemeral });
      }

      createdEvent = await guild.scheduledEvents.create({
        name: `${flightNumber} · ${session.airline}`,
        description: `${session.flightType === 'departure' ? 'Departure' : 'Arrival'} · ${route} · ${aircraft} · Terminal ${terminal} · ${session.status}`,
        scheduledStartTime: scheduledStart,
        scheduledEndTime: scheduledEnd,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location: route }
      });

      const payload = {
        type: session.flightType,
        date: session.date,
        flightNumber,
        ptfsDeparture,
        ptfsArrival,
        airline: session.airline,
        ...(session.flightType === 'departure' ? { departureTime: scheduledTime } : { arrivalTime: scheduledTime }),
        destination: route,
        aircraft,
        terminal,
        status: session.status,
        discordEvent: createdEvent.url || ''
      };

      const response = await fetch(`${context.config.fidsBaseUrl}/api/flights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FIDS-Key': context.config.fidsApiKey },
        body: JSON.stringify(payload)
      });
      const body = await response.text();
      let result;
      try { result = body ? JSON.parse(body) : null; } catch { result = null; }
      if (!response.ok || !result?.flight) {
        if (createdEvent) await createdEvent.delete().catch(() => {});
        console.error('[Discord] FIDS API rejected flight submission:', response.status, result?.error || 'Invalid API response');
        return interaction.reply({ content: 'The FIDS rejected this flight submission. Check the details and try again. If the problem continues, contact an administrator.', flags: MessageFlags.Ephemeral });
      }
      context.sessions.delete(interaction.user.id);
      return interaction.reply({
        embeds: [confirmationEmbed(result.flight)],
        components: createdEvent?.url ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('View Discord Event').setStyle(ButtonStyle.Link).setURL(createdEvent.url))] : [],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      if (createdEvent) await createdEvent.delete().catch(() => {});
      console.error('[Discord] Flight submission failed:', error);
      return interaction.reply({ content: 'I could not complete the flight submission. The Discord event was not kept. Please try again later.', flags: MessageFlags.Ephemeral });
    }
  }

  return interaction.reply({ content: 'That form is no longer valid. Start again with `/add-flight`.', flags: MessageFlags.Ephemeral });
}

module.exports = { data, execute, handleComponent, handleModal };
