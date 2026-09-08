const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function nextSundayMidnightUtc(now = new Date()) {
  const next = new Date(now.getTime());
  next.setUTCHours(0, 0, 0, 0);
  const daysUntilSunday = (7 - next.getUTCDay()) % 7;
  next.setUTCDate(next.getUTCDate() + daysUntilSunday);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

function startWeeklyScheduler(postWeeklyMessage, { logger = console } = {}) {
  let timer;

  const scheduleNext = () => {
    const target = nextSundayMidnightUtc();
    const delay = Math.max(0, target.getTime() - Date.now());
    logger.log(`[Discord] Next weekly flight message: ${target.toISOString()}`);
    timer = setTimeout(async () => {
      try {
        await postWeeklyMessage();
      } catch (error) {
        logger.error('[Discord] Weekly flight message failed:', error);
      } finally {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
  return () => clearTimeout(timer);
}

module.exports = { nextSundayMidnightUtc, startWeeklyScheduler, WEEK_MS };
