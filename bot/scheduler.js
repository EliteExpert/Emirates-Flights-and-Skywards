const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function nextSundayMidnightUtc(now = new Date()) {
  const next = new Date(now.getTime());
  next.setUTCHours(0, 0, 0, 0);

  // Sunday is 0. Always select the next Sunday 00:00 UTC,
  // including the following Sunday when already at/past this week's midnight.
  const daysUntilSunday = (7 - next.getUTCDay()) % 7;
  next.setUTCDate(next.getUTCDate() + daysUntilSunday);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

function startWeeklyScheduler(postWeeklyMessage, { logger = console } = {}) {
  let timer = null;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;

    const target = nextSundayMidnightUtc();
    const delay = Math.max(0, target.getTime() - Date.now());
    logger.log(`[Discord] Weekly flight scheduler armed for ${target.toISOString()} (Sunday 00:00 GMT).`);

    timer = setTimeout(async () => {
      timer = null;
      try {
        logger.log('[Discord] Publishing weekly flight schedule at Sunday 00:00 GMT.');
        await postWeeklyMessage();
        logger.log('[Discord] Weekly flight schedule published.');
      } catch (error) {
        logger.error('[Discord] Weekly flight message failed:', error);
      } finally {
        scheduleNext();
      }
    }, delay);

    // Keep the process free to shut down cleanly if Railway stops/restarts it.
    timer.unref?.();
  };

  scheduleNext();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

module.exports = { nextSundayMidnightUtc, startWeeklyScheduler, WEEK_MS };
