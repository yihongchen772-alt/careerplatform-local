"use client";

import { useEffect, useState } from "react";

/**
 * "Now" for countdowns. Starts from the server's instant so the first client
 * render matches the HTML, then ticks.
 */
export function useNow(initial: number, intervalMs = 30_000): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    // Back from sleep or another app: catch up at once.
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(first); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [intervalMs]);
  return now;
}
