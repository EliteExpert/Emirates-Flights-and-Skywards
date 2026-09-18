const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  EmbedBuilder
} = require('discord.js');
const { getConfig } = require('./config');
const { startWeeklyScheduler } = require('./scheduler');
const {
  weeklyFlights,
  currentGmtWeekStart,
  getWeeklyAnnouncementStatus,
  markWeeklyAnnouncementPosted
} = require('./api');
const { weeklyAnnouncementMessages } = require('./flight-ui');
const addFlight = require('./commands/add-flight');
const weeklyFlight = require('./commands/weekly-flight');
const flightsCommand = require('./commands/flights');
const updateFlight = require('./commands/update-flight');
const removeFlight = require('./commands/remove-flight');

let botPromise = null;

const commands = [addFlight.data, flightsCommand.data, updateFlight.data, removeFlight.data, weeklyFlight.data];

async function registerCommands(config) {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
    : Routes.applicationCommands(config.discordClientId);
  await rest.put(route, { body: commands });
  console.log(`[Discord] Registered ${commands.length} ${config.discordGuildId ? 'guild' : 'global'} commands.`);
}

function createClient() {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

async function startBot() {
  if (botPromise) return botPromise;
  botPromise = (async () => {
    const config = getConfig();
    const client = createClient();
    const sessions = new Map();
    const sessionCleanup = setInterval(() => {
      const cutoff = Date.now() - (10 * 60 * 1000);
      for (const [userId, session] of sessions) {
        if (session.createdAt <= cutoff) sessions.delete(userId);
      }
    }, 60_000);
    sessionCleanup.unref?.();

const WEEKLY_RETRY_ATTEMPTS = 3;
const WEEKLY_RETRY_DELAY_MS = 5 * 60 * 1000;

const postWeeklyMessage = async (channel) => {
  if (!channel?.isTextBased?.()) throw new Error('Weekly flight channel is unavailable or not text-based.');
  const summary = await weeklyFlights();
  const announcement = weeklyAnnouncementMessages(summary.flights, summary.weekStart);
  for (const payload of announcement.messages) {
    await channel.send(payload);
  }
  try {
    await markWeeklyAnnouncementPosted(summary.weekStart);
  } catch (error) {
    console.warn('[Discord] Could not record the weekly announcement marker:', error.message);
  }
  console.log(`[Discord] Weekly flight schedule published for week ${summary.weekStart}.`);
  return summary.weekStart;
};

const postWeeklyMessageWithRetry = async (channel) => {
  let lastError = null;
  for (let attempt = 1; attempt <= WEEKLY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await postWeeklyMessage(channel);
    } catch (error) {
      lastError = error;
      console.error(`[Discord] Weekly flight message attempt ${attempt}/${WEEKLY_RETRY_ATTEMPTS} failed:`, error.message || error);
      if (attempt < WEEKLY_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, WEEKLY_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
};

// Hosts like Render sleep idle web services, so the Sunday timer can vanish
// before it fires. On startup, publish the current week's schedule if it was
// never posted, using the FIDS marker row so a week is never posted twice.
const catchUpWeeklyAnnouncement = async (readyClient, config) => {
  try {
    const week = currentGmtWeekStart();
    const posted = await getWeeklyAnnouncementStatus(week);
    if (posted === null) {
      console.warn('[Discord] Weekly announcement tracking is unavailable (Supabase not configured); skipping startup catch-up.');
      return;
    }
    if (posted) return;
    const channel = await readyClient.channels.fetch(config.weeklyFlightChannelId);
    if (!channel?.isTextBased?.()) {
      console.error('[Discord] WEEKLY_FLIGHT_CHANNEL_ID is not a text channel; weekly catch-up skipped.');
      return;
    }
    console.log(`[Discord] Week ${week} has not been announced yet; publishing the catch-up schedule.`);
    await postWeeklyMessageWithRetry(channel);
  } catch (error) {
    console.error('[Discord] Weekly flight catch-up failed:', error);
  }
};

    client.once(Events.ClientReady, async (readyClient) => {
      console.log(`[Discord] Logged in as ${readyClient.user.tag}.`);
      try {
        await registerCommands(config);
      } catch (error) {
        console.error('[Discord] Command registration failed:', error);
      }

      try {
        const channel = await readyClient.channels.fetch(config.weeklyFlightChannelId);
        if (!channel?.isTextBased?.()) console.error('[Discord] WEEKLY_FLIGHT_CHANNEL_ID is not a text channel.');
      } catch (error) {
        console.error('[Discord] Weekly channel is unavailable:', error.message);
      }
      // Always re-fetch the channel when the timer fires so a deleted or
      // recreated channel at fire time is handled instead of throwing on a
      // stale reference captured at startup.
      startWeeklyScheduler(async () => {
        const channel = await readyClient.channels.fetch(config.weeklyFlightChannelId);
        await postWeeklyMessageWithRetry(channel);
      });
      await catchUpWeeklyAnnouncement(readyClient, config);
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          if (interaction.commandName === 'add-flight') return addFlight.execute(interaction, { config, sessions });
          if (interaction.commandName === 'flights') return flightsCommand.execute(interaction);
          if (interaction.commandName === 'update-flight') return updateFlight.execute(interaction);
          if (interaction.commandName === 'remove-flight') return removeFlight.execute(interaction);
          if (interaction.commandName === 'weekly-flight') return weeklyFlight.execute(interaction, {
            config,
            postWeeklyMessage: async () => {
              const channel = await client.channels.fetch(config.weeklyFlightChannelId);
              await postWeeklyMessage(channel);
            }
          });
        }

        if (interaction.isButton() || interaction.isStringSelectMenu()) {
          if (interaction.customId.startsWith('add-flight:')) return addFlight.handleComponent(interaction, { config, sessions });
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('add-flight:')) {
          return addFlight.handleModal(interaction, { config, sessions });
        }
      } catch (error) {
        console.error('[Discord] Interaction error:', error);
        const response = { content: 'Something went wrong while processing that interaction. Please try again.', flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => {});
        else await interaction.reply(response).catch(() => {});
      }
    });

    client.on(Events.Error, (error) => console.error('[Discord] Client error:', error));
    await client.login(config.discordToken);
    return client;
  })().catch((error) => {
    botPromise = null;
    throw error;
  });

  return botPromise;
}

if (require.main === module) {
  startBot().catch((error) => {
    console.error(`[Discord] Unable to start bot: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { startBot, registerCommands, createClient };
