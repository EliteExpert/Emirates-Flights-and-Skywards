const { getConfig } = require('./config');

async function request(path, options = {}) {
  const config = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${config.fidsBaseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        'X-FIDS-Key': config.fidsApiKey,
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!response.ok) {
      const error = new Error(body?.error || `Flight service returned HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function listFlights() {
  const body = await request('/api/flights');
  if (!Array.isArray(body)) throw new Error('Flight service returned an invalid flight list.');
  return body;
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

// Mirrors server.js: current Sunday through Saturday in GMT/UTC,
// with chronological flight ordering.
async function weeklyFlights() {
  const weekStart = currentGmtWeekStart();
  const weekEnd = addGmtDays(weekStart, 6);
  const flights = (await listFlights())
    .filter((flight) => flight.date >= weekStart && flight.date <= weekEnd)
    .sort((a, b) => {
      const at = `${a.date}T${a.departureTime || a.arrivalTime || '00:00'}:00Z`;
      const bt = `${b.date}T${b.departureTime || b.arrivalTime || '00:00'}:00Z`;
      return at.localeCompare(bt);
    });
  return { weekStart, weekEnd, totalFlights: flights.length, flights };
}

async function weeklySummary() {
  try {
    const body = await request('/api/flights/weekly-summary');
    if (body && typeof body === 'object' && Array.isArray(body.flights) && typeof body.message === 'string') return body;
  } catch (error) {
    console.warn(`[Discord] Weekly-summary endpoint unavailable (${error.status || 'request error'}); using /api/flights fallback.`);
  }
  return weeklyFlights();
}

// Returns true/false when the FIDS tracks announcements, or null when the
// marker store is unavailable (no Supabase) so callers can skip catch-up.
async function getWeeklyAnnouncementStatus(week) {
  try {
    const body = await request(`/api/weekly-announcement?week=${encodeURIComponent(week)}`);
    if (body && typeof body.posted === 'boolean') return body.posted;
  } catch (error) {
    console.warn(`[Discord] Weekly-announcement status unavailable (${error.status || 'request error'}).`);
  }
  return null;
}

async function markWeeklyAnnouncementPosted(week) {
  await request('/api/weekly-announcement', { method: 'POST', body: JSON.stringify({ week }) });
}

async function createFlight(flight) {
  return request('/api/flights', { method: 'POST', body: JSON.stringify(flight) });
}
async function updateStatus(identity, status) {
  return request('/api/flights/status', { method: 'POST', body: JSON.stringify({ ...identity, status }) });
}
async function removeFlight(identity) {
  return request('/api/flights/remove', { method: 'POST', body: JSON.stringify(identity) });
}

module.exports = {
  request,
  listFlights,
  weeklyFlights,
  weeklySummary,
  currentGmtWeekStart,
  getWeeklyAnnouncementStatus,
  markWeeklyAnnouncementPosted,
  createFlight,
  updateStatus,
  removeFlight
};
