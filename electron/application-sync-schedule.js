const RETRY_MS = 15 * 60 * 1000;

function createApplicationSyncSchedule() {
  let nextAt = 0;
  let inFlight = false;
  let resetDuringFlight = false;
  return {
    reset() { nextAt = 0; resetDuringFlight = inFlight; },
    begin(intervalMs, now = Date.now()) {
      if (intervalMs <= 0) { nextAt = 0; return false; }
      if (inFlight || now < nextAt) return false;
      inFlight = true;
      resetDuringFlight = false;
      return true;
    },
    finish(intervalMs, healthy, now = Date.now()) {
      inFlight = false;
      nextAt = resetDuringFlight ? 0 : now + (healthy ? intervalMs : Math.min(intervalMs, RETRY_MS));
      resetDuringFlight = false;
    },
  };
}

module.exports = { createApplicationSyncSchedule };
