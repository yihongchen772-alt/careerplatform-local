/**
 * Local calendar day as `YYYY-MM-DD`, never UTC.
 *
 * `toISOString().slice(0, 10)` is the tempting one-liner and it is wrong for
 * every timezone ahead of UTC: in China (UTC+8) it returns *yesterday* between
 * 00:00 and 08:00 local, so a form defaulting to "today" would silently record
 * the wrong 投递日期. It also breaks hydration, since the server (UTC on
 * Vercel) and the browser disagree on the string.
 */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today as `YYYY-MM-DD` in the viewer's own timezone. */
export function todayKey(): string {
  return toDateKey(new Date());
}
