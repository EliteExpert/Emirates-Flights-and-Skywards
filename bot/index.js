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
const { weeklyFlightEmbed, weeklyFlightListing } = require('./flight-ui');
const addFlight = require('./commands/add-flight');
const weeklyFlight = require('./commands/weekly-flight');

let botPromise = null;

const commands = [addFlight.data, weeklyFlight.data];

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

    const fetchWeeklyFlights = async () => {
      const response = await fetch(`${config.fidsBaseUrl}/api/flights`);
      const body = await response.text();
      let flights;
      try { flights = body ? JSON.parse(body) : []; } catch { flights = []; }
      if (!response.ok || !Array.isArray(flights)) throw new Error('FIDS flight listing could not be loaded.');

      const now = new Date();
      const day = now.getUTCDay();
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      const startDate = start.toISOString().slice(0, 10);
      const endDate = end.toISOString().slice(0, 10);
      return flights.filter((flight) => flight.date >= startDate && flight.date <= endDate);
    };

    const postWeeklyMessage = async (channel) => {
      if (!channel?.isTextBased?.()) throw new Error('Weekly flight channel is unavailable or not text-based.');
      const flights = await fetchWeeklyFlights();
      await channel.send({ embeds: [weeklyFlightEmbed()] });
      for (const message of weeklyFlightListing(flights)) {
        await channel.send(message);
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
        else startWeeklyScheduler(() => postWeeklyMessage(channel));
      } catch (error) {
        console.error('[Discord] Weekly channel is unavailable:', error);
        startWeeklyScheduler(async () => {
          const channel = await readyClient.channels.fetch(config.weeklyFlightChannelId);
          await postWeeklyMessage(channel);
        });
      }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          if (interaction.commandName === 'add-flight') return addFlight.execute(interaction, { config, sessions });
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
        const response = { content: 'Something went wrong while processing that interaction. Please try again.', ephemeral: true };
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
