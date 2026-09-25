const RETRY_MS = 15 * 60 * 1000;

function createApplicationSyncSchedule() {
  let nextAt = 0;
  let inFlight = false;
  return {
    begin(intervalMs, now = Date.now()) {
      if (intervalMs <= 0) { nextAt = 0; return false; }
      if (inFlight || now < nextAt) return false;
      inFlight = true;
      return true;
    },
    finish(intervalMs, healthy, now = Date.now()) {
      inFlight = false;
      nextAt = now + (healthy ? intervalMs : Math.min(intervalMs, RETRY_MS));
    },
  };
}

module.exports = { createApplicationSyncSchedule };
