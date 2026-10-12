"use client";

/**
 * A batch delete waits a few seconds before it happens, so its toast can
 * offer 撤销. The wait lives at module level: leaving 投递记录 does not drop
 * it, and closing the window sends it with a beacon instead of losing it.
 */
type Pending = { ids: string[]; timer: ReturnType<typeof setTimeout> };

const pending = new Map<number, Pending>();
let nextKey = 1;
let listening = false;

function flushOnClose() {
  for (const [key, entry] of pending) {
    clearTimeout(entry.timer);
    pending.delete(key);
    try {
      navigator.sendBeacon("/api/applications/bulk-delete", new Blob([JSON.stringify({ ids: entry.ids })], { type: "application/json" }));
    } catch {
      // Nothing else can run while the page goes away; the rows stay.
    }
  }
}

/** Schedules the delete; returns undo, which is true while it still could. */
export function deleteLater(ids: string[], commit: (ids: string[]) => Promise<void>, delayMs = 8000): () => boolean {
  if (!listening) {
    window.addEventListener("pagehide", flushOnClose);
    listening = true;
  }
  const key = nextKey++;
  const timer = setTimeout(() => {
    pending.delete(key);
    void commit(ids);
  }, delayMs);
  pending.set(key, { ids, timer });
  return () => {
    const entry = pending.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pending.delete(key);
    return true;
  };
}
