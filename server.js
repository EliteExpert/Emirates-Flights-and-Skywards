const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIRECTORY = path.join(__dirname, 'public');
const FLIGHTS_FILE = path.join(PUBLIC_DIRECTORY, 'flights.json');
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FIDS_API_KEY = process.env.FIDS_API_KEY;
const ALLOWED_STATUSES = new Set([
  'Check-in Open', 'Boarding', 'Final Call', 'Gate Closed',
  'Delayed', 'Cancelled', 'Departed', 'In Flight', 'Arrived'
]);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(PUBLIC_DIRECTORY));

function isDatabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function assertApiAccess(req, res, next) {
  const suppliedKey = req.get('x-fids-key');
  if (!FIDS_API_KEY || !suppliedKey) {
    return res.status(401).json({ error: 'A valid FIDS API key is required.' });
  }

  const expected = Buffer.from(FIDS_API_KEY);
  const supplied = Buffer.from(suppliedKey);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return res.status(401).json({ error: 'A valid FIDS API key is required.' });
  }
  return next();
}

async function supabaseRequest(endpoint, options = {}) {
  if (!isDatabaseConfigured()) {
    throw new Error('The Supabase database is not configured.');
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(body || `Supabase request failed with ${response.status}.`);
  }
  return body ? JSON.parse(body) : null;
}

function toClientFlight(row) {
  return {
    id: row.id,
    type: row.type,
    date: row.flight_date,
    flightNumber: row.flight_number,
    airline: row.airline,
    departureTime: row.departure_time?.slice(0, 5),
    arrivalTime: row.arrival_time?.slice(0, 5),
    destination: row.destination,
    aircraft: row.aircraft,
    terminal: row.terminal,
    status: row.status,
    discordEvent: row.discord_event
  };
}

function cleanText(value, name, maximumLength = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximumLength) {
    throw new Error(`${name} is required and must be ${maximumLength} characters or fewer.`);
  }
  return value.trim();
}

function cleanFlight(body) {
  const type = cleanText(body.type, 'Type', 20).toLowerCase();
  if (!['departure', 'arrival'].includes(type)) throw new Error('Type must be departure or arrival.');

  const date = cleanText(body.date, 'Date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must use YYYY-MM-DD.');

  const timeKey = type === 'departure' ? 'departureTime' : 'arrivalTime';
  const scheduledTime = cleanText(body[timeKey], type === 'departure' ? 'Departure time' : 'Arrival time', 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) throw new Error('Time must use 24-hour HH:MM format.');

  const status = cleanText(body.status, 'Status', 40);
  if (!ALLOWED_STATUSES.has(status)) throw new Error('Status is not supported.');

  const discordEvent = typeof body.discordEvent === 'string' ? body.discordEvent.trim() : typeof body.discordEventUrl === 'string' ? body.discordEventUrl.trim() : '';
  let eventUrl = null;
  if (discordEvent) {
    try {
      eventUrl = new URL(discordEvent);
    } catch {
      throw new Error('Discord event URL must be a valid URL.');
    }
    if (eventUrl.protocol !== 'https:') throw new Error('Discord event URL must use HTTPS.');
  }

  return {
    type,
    flight_date: date,
    flight_number: cleanText(body.flightNumber, 'Flight number', 20).toUpperCase(),
    airline: cleanText(body.airline || 'Emirates PTFS', 'Airline', 80),
    departure_time: type === 'departure' ? scheduledTime : null,
    arrival_time: type === 'arrival' ? scheduledTime : null,
    destination: cleanText(body.destination, 'Destination', 140),
    aircraft: cleanText(body.aircraft, 'Aircraft', 80),
    terminal: cleanText(body.terminal, 'Terminal', 20).toUpperCase(),
    status,
    discord_event: eventUrl ? eventUrl.toString() : ''
  };
}

function identityFrom(body) {
  const type = cleanText(body.type, 'Type', 20).toLowerCase();
  const date = cleanText(body.date, 'Date', 10);
  const flightNumber = cleanText(body.flightNumber, 'Flight number', 20).toUpperCase();
  if (!['departure', 'arrival'].includes(type)) throw new Error('Type must be departure or arrival.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must use YYYY-MM-DD.');
  return { type, date, flightNumber };
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

// Discord custom emoji shown before a flight's number, keyed by the IATA
// airline code the flight number starts with (EK247, FZ123, ...).
const AIRLINE_EMOJIS = {
  EK: '<:Emiratesnewtail:1480910652427079680>',
  FZ: '<:flydubai:1531904943001440338>'
};

function airlineEmoji(flightNumber) {
  const prefix = String(flightNumber || '').trim().toUpperCase().match(/^[A-Z]{2}/);
  const emoji = prefix && AIRLINE_EMOJIS[prefix[0]];
  return emoji ? `${emoji} ` : '';
}

function weeklyDiscordMessage(flights, weekStart, boardUrl) {
  const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const conciseDate = (date) => dateFormat.format(date).replace(',', '');
  const lines = [
    '**<:EKcrest:1315380870965624995> Emirates PTFS Weekly Flight Schedule**',
    `> **${conciseDate(new Date(`${weekStart}T00:00:00Z`))} – ${conciseDate(new Date(`${addGmtDays(weekStart, 6)}T00:00:00Z`))} **`,
    ''
  ];

  let omitted = 0;
  for (const flight of flights) {
    const time = flight.departureTime || flight.arrivalTime;
    const type = flight.type === 'departure' ? 'DEP' : 'ARR';
    const line = `• ${conciseDate(new Date(`${flight.date}T00:00:00Z`))} · **${time} GMT** · ${airlineEmoji(flight.flightNumber)}${flight.flightNumber} · ${flight.destination} (${type})`;
    if ([...lines, line, '', `View the live board: ${boardUrl}`].join('\n').length > 1_850) {
      omitted += 1;
    } else {
      lines.push(line);
    }
  }

  if (!flights.length) lines.push('No flights are currently scheduled for this week.');
  if (omitted) lines.push(`\n+${omitted} more flight${omitted === 1 ? '' : 's'} — view the live board for the full schedule.`);
  lines.push('', `View the live board: **${boardUrl}**`, '-# <:Emiratesnewtail:1480910652427079680> **Fly Emirates** <@&1295727684806115328>');
  return lines.join('\n');
}

async function readSampleFlights() {
  return JSON.parse(await fs.readFile(FLIGHTS_FILE, 'utf8'));
}

function gmtDateToday() {
  return new Date().toISOString().slice(0, 10);
}

async function removeExpiredFlights() {
  if (!isDatabaseConfigured()) return;
  await supabaseRequest(`flights?flight_date=lt.${gmtDateToday()}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });
}

app.get('/', (_req, res) => res.redirect('/departures'));
app.get('/departures', (_req, res) => res.render('departures', { activePage: 'departures' }));
app.get('/arrivals', (_req, res) => res.render('arrivals', { activePage: 'arrivals' }));
app.get('/health', (_req, res) => res.json({ ok: true, database: isDatabaseConfigured() ? 'supabase' : 'sample-data' }));

app.get('/api/flights', async (_req, res, next) => {
  try {
    if (!isDatabaseConfigured()) return res.json(await readSampleFlights());
    await removeExpiredFlights();
    const rows = await supabaseRequest('flights?select=*&order=flight_date.asc,departure_time.asc,arrival_time.asc');
    return res.json(rows.map(toClientFlight));
  } catch (error) {
    return next(error);
  }
});

app.get('/api/flights/weekly-summary', assertApiAccess, async (req, res, next) => {
  try {
    if (!isDatabaseConfigured()) return res.status(503).json({ error: 'Weekly summaries require Supabase.' });
    await removeExpiredFlights();
    const weekStart = currentGmtWeekStart();
    const weekEnd = addGmtDays(weekStart, 6);
    const rows = await supabaseRequest(`flights?select=*&flight_date=gte.${weekStart}&flight_date=lte.${weekEnd}&order=flight_date.asc,departure_time.asc,arrival_time.asc`);
    const flights = rows.map(toClientFlight);
    const boardUrl = `${req.protocol}://${req.get('host')}/departures`;
    return res.json({
      weekStart,
      weekEnd,
      totalFlights: flights.length,
      flights,
      message: weeklyDiscordMessage(flights, weekStart, boardUrl)
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/weekly-announcement', assertApiAccess, async (req, res, next) => {
  try {
    const week = cleanText(req.query.week, 'Week', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return res.status(400).json({ error: 'Week must use YYYY-MM-DD.' });
    if (!isDatabaseConfigured()) return res.status(503).json({ error: 'Weekly announcement tracking requires Supabase.' });
    const rows = await supabaseRequest(`weekly_announcements?select=week_start&week_start=eq.${week}`);
    return res.json({ week, posted: rows.length > 0 });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/weekly-announcement', assertApiAccess, async (req, res, next) => {
  try {
    const week = cleanText(req.body.week, 'Week', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return res.status(400).json({ error: 'Week must use YYYY-MM-DD.' });
    if (!isDatabaseConfigured()) return res.status(503).json({ error: 'Weekly announcement tracking requires Supabase.' });
    await supabaseRequest('weekly_announcements?on_conflict=week_start', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ week_start: week })
    });
    return res.json({ week, posted: true });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/flights', assertApiAccess, async (req, res, next) => {
  try {
    const flight = cleanFlight(req.body);
    const rows = await supabaseRequest('flights?on_conflict=type,flight_date,flight_number', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(flight)
    });
    return res.status(200).json({ flight: toClientFlight(rows[0]), message: 'Flight saved.' });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/flights/status', assertApiAccess, async (req, res, next) => {
  try {
    const { type, date, flightNumber } = identityFrom(req.body);
    const status = cleanText(req.body.status, 'Status', 40);
    if (!ALLOWED_STATUSES.has(status)) throw new Error('Status is not supported.');
    const filter = new URLSearchParams({ type: `eq.${type}`, flight_date: `eq.${date}`, flight_number: `eq.${flightNumber}` });
    const rows = await supabaseRequest(`flights?${filter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status })
    });
    if (!rows.length) return res.status(404).json({ error: 'Flight not found.' });
    return res.json({ flight: toClientFlight(rows[0]), message: 'Flight status updated.' });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/flights/remove', assertApiAccess, async (req, res, next) => {
  try {
    const { type, date, flightNumber } = identityFrom(req.body);
    const filter = new URLSearchParams({ type: `eq.${type}`, flight_date: `eq.${date}`, flight_number: `eq.${flightNumber}` });
    const rows = await supabaseRequest(`flights?${filter}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' }
    });
    if (!rows || !rows.length) return res.status(404).json({ error: 'Flight not found.' });
    return res.json({ message: 'Flight removed.' });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.message.includes('required') || error.message.includes('must') || error.message.includes('supported')
    ? 400
    : 500;
  res.status(status).json({ error: status === 500 ? 'The flight service is unavailable.' : error.message });
});

app.listen(PORT, () => {
  console.log(`Emirates PTFS FIDS is ready at http://localhost:${PORT}`);
  if (process.env.DISCORD_TOKEN?.trim()) {
    try {
      const { startBot } = require('./bot');
      startBot().catch((error) => console.error('[Discord] Combined startup failed:', error.message));
    } catch (error) {
      console.error('[Discord] Combined startup failed:', error.message);
    }
  }
  removeExpiredFlights().catch((error) => console.error('Unable to remove expired flights:', error));
  setInterval(() => {
    removeExpiredFlights().catch((error) => console.error('Unable to remove expired flights:', error));
  }, 60_000);
});
