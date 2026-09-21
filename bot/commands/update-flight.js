const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { listFlights, updateStatus, createFlight } = require('../api');
const { STATUSES, validTime } = require('../flight-ui');

const data = {
  name: 'update-flight',
  description: 'Update the status and/or timing of an existing flight.',
  default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
  options: [
    { name: 'type', description: 'Departure or arrival.', type: 3, required: true, choices: [{ name: 'Departure', value: 'departure' }, { name: 'Arrival', value: 'arrival' }] },
    { name: 'date', description: 'Flight date in YYYY-MM-DD.', type: 3, required: true },
    { name: 'flight-number', description: 'Flight number, e.g. EK247.', type: 3, required: true },
    { name: 'status', description: 'New flight status.', type: 3, required: false, choices: STATUSES.map((s) => ({ name: s, value: s })) },
    { name: 'time', description: 'New scheduled time in GMT (HH:MM) — reschedules the Discord event too.', type: 3, required: false }
  ]
};

function parseEventId(discordEvent) {
  const match = String(discordEvent || '').match(/\/events\/[^/]+\/(\d+)/);
  return match ? match[1] : null;
}

async function execute(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'You need Manage Server permission to update flights.', flags: MessageFlags.Ephemeral });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const identity = {
    type: interaction.options.getString('type'),
    date: interaction.options.getString('date'),
    flightNumber: interaction.options.getString('flight-number').trim().toUpperCase()
  };
  const status = interaction.options.getString('status');
  const newTime = interaction.options.getString('time')?.trim();

  if (!status && !newTime) {
    return interaction.editReply({ content: 'Provide a new `status`, a new `time`, or both — there is nothing to update otherwise.' });
  }

  try {
    if (newTime && !validTime(newTime)) {
      return interaction.editReply({ content: 'Invalid time. Use 24-hour `HH:MM` format, for example `19:30`.' });
    }

    // A timing change reschedules the flight everywhere, so pull the stored
    // record for its Discord event link and remaining fields.
    let flight = null;
    if (newTime) {
      const flights = await listFlights();
      flight = flights.find((f) => f.type === identity.type && f.date === identity.date && String(f.flightNumber).toUpperCase() === identity.flightNumber);
      if (!flight) return interaction.editReply({ content: 'That flight could not be found on the schedule.' });

      const scheduledStart = new Date(`${flight.date}T${newTime}:00Z`);
      if (scheduledStart.getTime() <= Date.now()) {
        return interaction.editReply({ content: 'The new time must be in the future so the Discord event can be rescheduled.' });
      }
    }

    // 1. Reschedule the linked Discord event (1hr block, like creation)
    let eventNote = '';
    if (newTime) {
      const eventId = parseEventId(flight.discordEvent);
      if (eventId) {
        try {
          const guild = await interaction.client.guilds.fetch(interaction.guildId);
          const scheduledStart = new Date(`${flight.date}T${newTime}:00Z`);
          const scheduledEnd = new Date(scheduledStart.getTime() + 60 * 60 * 1000);
          await guild.scheduledEvents.edit(eventId, { scheduledStartTime: scheduledStart, scheduledEndTime: scheduledEnd });
          eventNote = 'Discord event rescheduled. ';
        } catch (error) {
          console.error('[Discord] Event reschedule failed:', error);
          eventNote = 'The Discord event could not be rescheduled (it may have been deleted) — the schedule was still updated. ';
        }
      } else {
        eventNote = 'No Discord event is linked to this flight. ';
      }
    }

    // 2. Update the FIDS: status only via the status endpoint, timing via the
    //    merge upsert with the full record so every field survives.
    let updated;
    if (newTime) {
      const payload = {
        type: flight.type,
        date: flight.date,
        flightNumber: flight.flightNumber,
        airline: flight.airline,
        ...(flight.type === 'departure' ? { departureTime: newTime } : { arrivalTime: newTime }),
        destination: flight.destination,
        aircraft: flight.aircraft,
        terminal: flight.terminal,
        status: status || flight.status,
        discordEvent: flight.discordEvent || '',
        ptfsDeparture: flight.ptfsDeparture || '',
        ptfsArrival: flight.ptfsArrival || ''
      };
      updated = (await createFlight(payload)).flight;
    } else {
      updated = (await updateStatus(identity, status)).flight;
    }

    const time = updated.departureTime || updated.arrivalTime;
    const embed = new EmbedBuilder()
      .setTitle('Flight Updated')
      .setDescription(`**${updated.flightNumber}** updated.${eventNote ? `\n${eventNote.trim()}` : ''}`)
      .addFields(
        { name: 'Date', value: updated.date, inline: true },
        { name: 'Type', value: updated.type === 'departure' ? 'Departure' : 'Arrival', inline: true },
        { name: 'Status', value: updated.status, inline: true },
        { name: 'Scheduled', value: `${time} GMT`, inline: true }
      )
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[Discord] /update-flight failed:', error);
    return interaction.editReply({ content: error.status === 404 ? 'That flight could not be found.' : 'I could not update that flight.' });
  }
}
module.exports = { data, execute };
