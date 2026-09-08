let page = document.body.dataset.page;
const flightList = document.querySelector('#flight-list');
const searchInput = document.querySelector('#flight-search');
const resultCount = document.querySelector('#result-count');
const liveClock = document.querySelector('#live-clock');
let flights = [];
let previousClockValue = '';
let clockCleanupTimer;

const displayDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric'
});
const displayTime = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hour12: false
});

function flightDate(flight) {
  const time = flight.departureTime || flight.arrivalTime;
  // Flight schedules are stored and compared in GMT, independent of the viewer's device timezone.
  return new Date(`${flight.date}T${time}:00Z`);
}

function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function statusClass(status) {
  return `status-${status.toLowerCase().replace(/\s+/g, '-')}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function airlineTail(flight) {
  return /fly\s*dubai/i.test(flight.airline)
    ? '/flydubai-tail.png'
    : '/emirates-tail.png';
}

function timing(flight) {
  const difference = flightDate(flight).getTime() - Date.now();
  if (['Delayed', 'Cancelled'].includes(flight.status)) {
    return { text: '', status: flight.status };
  }
  if (page === 'departures' && difference <= 0) {
    return { text: '', status: 'Departed' };
  }
  if (difference <= 0) return { text: '', status: flight.status };

  const totalMinutes = Math.floor(difference / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { text: `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`, status: flight.status };
}

function flightCard(flight, index) {
  const scheduledDate = flightDate(flight);
  const scheduledTime = displayTime.format(scheduledDate);
  const isDeparture = page === 'departures';
  const live = timing(flight);
  return `
    <article class="flight-card" style="animation-delay:${Math.min(index * 45, 360)}ms">
      <div class="time">
        <time datetime="${escapeHtml(scheduledDate.toISOString())}">${escapeHtml(scheduledTime)}</time>
        ${live.text ? `<span class="countdown">${isDeparture ? `Departs in ${live.text}` : `Arrives in ${live.text}`}</span>` : ''}
      </div>
      <div class="flight-id">
        <div class="flight-number-row"><img class="tail-logo" src="${airlineTail(flight)}" alt="" /><span class="flight-number">${escapeHtml(flight.flightNumber)}</span></div>
        <span class="airline">${escapeHtml(flight.airline)}</span>
      </div>
      <div class="cell destination-cell"><span class="cell-label">${isDeparture ? 'Destination' : 'Origin'}</span><span class="cell-value">${escapeHtml(flight.destination)}</span></div>
      <div class="cell aircraft-cell"><span class="cell-label">Aircraft</span><span class="cell-value">${escapeHtml(flight.aircraft)}</span></div>
      <div class="cell terminal-cell"><span class="cell-label">Terminal</span><span class="terminal">${escapeHtml(flight.terminal)}</span></div>
      <span class="status ${statusClass(live.status)}">${escapeHtml(live.status)}</span>
    </article>`;
}

function render() {
  const search = searchInput.value.trim().toLowerCase();
  const type = page === 'departures' ? 'departure' : 'arrival';
  const visible = flights.filter((flight) => flight.type === type &&
    [flight.flightNumber, flight.destination, flight.aircraft]
    .some((value) => value.toLowerCase().includes(search))
  );

  resultCount.textContent = `${visible.length} ${visible.length === 1 ? 'flight' : 'flights'} shown`;
  if (!visible.length) {
    flightList.innerHTML = '<div class="empty-state">No flights match that search. Try a flight number, destination or aircraft.</div>';
    return;
  }

  const groups = visible.reduce((all, flight) => {
    const date = localDateKey(flightDate(flight));
    (all[date] ||= []).push(flight);
    return all;
  }, {});
  flightList.innerHTML = Object.entries(groups).map(([date, items]) => `
    <section class="date-group">
      <h2 class="date-heading">${displayDate.format(new Date(`${date}T00:00:00`))}</h2>
      ${items.map(flightCard).join('')}
    </section>`).join('');
}

function setPage(nextPage, updateHistory = true) {
  page = nextPage;
  document.body.dataset.page = page;
  const departures = page === 'departures';
  document.title = `${departures ? 'Departures' : 'Arrivals'} | Emirates PTFS`;
  document.querySelector('#page-title').textContent = departures ? 'Departures' : 'Arrivals';
  document.querySelector('#page-intro').textContent = departures
    ? 'Your next journey begins here.'
    : 'Welcome to Dubai. Track your arriving flight.';
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.view === page);
  });
  if (updateHistory) history.pushState({ page }, '', `/${page}`);
  searchInput.value = '';
  render();
}

function updateClock() {
  const clockValue = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date()).replace(/\D/g, '');
  const cards = clockValue.split('').map((digit, index) => {
    const previous = previousClockValue[index] || digit;
    const changed = Boolean(previousClockValue) && previous !== digit;
    return `<span class="flip-card${changed ? ' is-flipping' : ''}">
      <span class="flip-card-face flip-card-current">${previous}</span>
      ${changed ? `<span class="flip-card-face flip-card-next">${digit}</span>` : ''}
    </span>`;
  });
  cards.splice(2, 0, '<span class="flip-separator" aria-hidden="true">:</span>');
  liveClock.innerHTML = cards.join('');
  liveClock.setAttribute('aria-label', `Current local time ${clockValue.slice(0, 2)}:${clockValue.slice(2)}`);
  previousClockValue = clockValue;

  if (liveClock.querySelector('.is-flipping')) {
    window.clearTimeout(clockCleanupTimer);
    clockCleanupTimer = window.setTimeout(() => {
      liveClock.querySelectorAll('.is-flipping').forEach((card) => {
        const nextDigit = card.querySelector('.flip-card-next')?.textContent;
        card.classList.remove('is-flipping');
        card.innerHTML = `<span class="flip-card-face flip-card-current">${nextDigit}</span>`;
      });
    }, 700);
  }
}

function startMinuteCycle() {
  const tick = () => {
    updateClock();
    render();
  };
  tick();
  const delay = 60_100 - (Date.now() % 60_000);
  window.setTimeout(() => {
    tick();
    window.setInterval(() => {
      tick();
      loadFlights();
    }, 60_000);
  }, delay);
}

async function loadFlights() {
  try {
    const response = await fetch('/api/flights');
    if (!response.ok) throw new Error('Flight data could not be loaded.');
    flights = (await response.json())
      .sort((first, second) => flightDate(first) - flightDate(second));
    render();
  } catch (error) {
    flightList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

searchInput.addEventListener('input', render);
document.querySelector('.tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-view]');
  if (!tab || tab.dataset.view === page) return;
  event.preventDefault();
  setPage(tab.dataset.view);
});
loadFlights();
startMinuteCycle();
window.addEventListener('popstate', () => {
  const nextPage = location.pathname.includes('arrivals') ? 'arrivals' : 'departures';
  if (nextPage !== page) setPage(nextPage, false);
});
