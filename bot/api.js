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

async function createFlight(flight) {
  return request('/api/flights', { method: 'POST', body: JSON.stringify(flight) });
}

async function updateStatus(identity, status) {
  return request('/api/flights/status', {
    method: 'POST',
    body: JSON.stringify({ ...identity, status })
  });
}

async function removeFlight(identity) {
  return request('/api/flights/remove', {
    method: 'POST',
    body: JSON.stringify(identity)
  });
}

module.exports = { request, listFlights, createFlight, updateStatus, removeFlight };
