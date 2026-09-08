const DEFAULT_FIDS_BASE_URL = 'http://127.0.0.1:3000';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function getConfig({ requireDiscord = true } = {}) {
  const fidsBaseUrl = (process.env.FIDS_BASE_URL || DEFAULT_FIDS_BASE_URL).replace(/\/$/, '');
  let parsedUrl;
  try {
    parsedUrl = new URL(fidsBaseUrl);
  } catch {
    throw new Error('FIDS_BASE_URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('FIDS_BASE_URL must use HTTP or HTTPS.');
  }

  const config = {
    discordToken: process.env.DISCORD_TOKEN?.trim(),
    discordClientId: process.env.DISCORD_CLIENT_ID?.trim(),
    discordGuildId: process.env.DISCORD_GUILD_ID?.trim(),
    weeklyFlightChannelId: process.env.WEEKLY_FLIGHT_CHANNEL_ID?.trim(),
    fidsBaseUrl,
    fidsApiKey: process.env.FIDS_API_KEY?.trim()
  };

  if (requireDiscord) {
    required('DISCORD_TOKEN');
    required('DISCORD_CLIENT_ID');
    required('WEEKLY_FLIGHT_CHANNEL_ID');
    required('FIDS_API_KEY');
  }

  return config;
}

module.exports = { getConfig, DEFAULT_FIDS_BASE_URL };
