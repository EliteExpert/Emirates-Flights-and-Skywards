const {
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
} = require('../flight-ui');

const data = { name: 'add-flight', description: 'Submit a flight to the Emirates PTFS FIDS.' };

function cancelReply() {
  return { content: 'Flight entry cancelled.', components: [], ephemeral: true };
}

function sessionError(interaction) {
  return interaction.reply({ content: 'This flight-entry session has expired or is unavailable. Start again with `/add-flight`.', ephemeral: true });
}

async function execute(interaction, { sessions }) {
  const existing = sessions.get(interaction.user.id);
  if (existing) sessions.delete(interaction.user.id);
  sessions.set(interaction.user.id, makeSession(interaction.user.id));

  return interaction.reply({
    content: 'Choose the flight type. Your entry session expires after 10 minutes.',
    components: flightTypeRows(),
    ephemeral: true
  });
}

async function handleComponent(interaction, context) {
  const session = getSession(context.sessions, interaction.user.id);
  if (!session) return sessionError(interaction);
  if (session.userId !== interaction.user.id) return interaction.reply({ content: 'You cannot use another user\'s flight-entry session.', ephemeral: true });

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
    session.airline = value === 'emirates' ? 'Emirates' : value === 'etihad-airways' ? 'Etihad Airways' : 'Qatar Airways';
    return interaction.update({ content: 'Select the flight status.', components: statusRow() });
  }

  if (action === 'status') {
    session.status = interaction.values[0];
    return interaction.showModal(detailsModal());
  }

  return interaction.reply({ content: 'That flight-entry control is no longer valid. Start again with `/add-flight`.', ephemeral: true });
}

async function handleModal(interaction, context) {
  const session = getSession(context.sessions, interaction.user.id);
  if (!session) return sessionError(interaction);
  if (session.userId !== interaction.user.id) return interaction.reply({ content: 'You cannot use another user\'s flight-entry session.', ephemeral: true });

  if (interaction.customId === 'add-flight:date') {
    const date = interaction.fields.getTextInputValue('date').trim();
    if (!validDate(date)) {
      return interaction.reply({ content: 'Invalid date. Use a real date in `YYYY-MM-DD` format, for example `2026-09-13`.', ephemeral: true });
    }
    session.date = date;
    return interaction.reply({ content: 'Choose the airline.', components: airlineRows(), ephemeral: true });
  }

  if (interaction.customId === 'add-flight:airline-other') {
    const airline = interaction.fields.getTextInputValue('airline').trim();
    if (!airline) return interaction.reply({ content: 'Please provide an airline name.', ephemeral: true });
    session.airline = airline;
    return interaction.reply({ content: 'Select the flight status.', components: statusRow(), ephemeral: true });
  }

  if (interaction.customId === 'add-flight:details') {
    const flightNumber = interaction.fields.getTextInputValue('flightNumber').trim().toUpperCase();
    const scheduledTime = interaction.fields.getTextInputValue('scheduledTime').trim();
    const route = interaction.fields.getTextInputValue('route').trim();
    const aircraft = interaction.fields.getTextInputValue('aircraft').trim();
    const terminal = interaction.fields.getTextInputValue('terminal').trim().toUpperCase();

    if (!validTime(scheduledTime)) {
      return interaction.reply({ content: 'Invalid scheduled time. Use 24-hour `HH:MM` format, for example `19:30`.', ephemeral: true });
    }

    const payload = {
      type: session.flightType,
      date: session.date,
      flightNumber,
      airline: session.airline,
      ...(session.flightType === 'departure' ? { departureTime: scheduledTime } : { arrivalTime: scheduledTime }),
      destination: route,
      aircraft,
      terminal,
      status: session.status,
      discordEvent: ''
    };

    try {
      const response = await fetch(`${context.config.fidsBaseUrl}/api/flights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FIDS-Key': context.config.fidsApiKey },
        body: JSON.stringify(payload)
      });
      const body = await response.text();
      let result;
      try { result = body ? JSON.parse(body) : null; } catch { result = null; }
      if (!response.ok || !result?.flight) {
        console.error('[Discord] FIDS API rejected flight submission:', response.status, result?.error || 'Invalid API response');
        return interaction.reply({ content: 'The FIDS rejected this flight submission. Check the details and try again. If the problem continues, contact an administrator.', ephemeral: true });
      }
      context.sessions.delete(interaction.user.id);
      return interaction.reply({ embeds: [confirmationEmbed(result.flight)], ephemeral: true });
    } catch (error) {
      console.error('[Discord] FIDS API request failed:', error);
      return interaction.reply({ content: 'I could not reach the FIDS server. Please try again later.', ephemeral: true });
    }
  }

  return interaction.reply({ content: 'That form is no longer valid. Start again with `/add-flight`.', ephemeral: true });
}

module.exports = { data, execute, handleComponent, handleModal };
