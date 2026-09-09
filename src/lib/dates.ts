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

/**
 * Monday of the current local week, as `YYYY-MM-DD` — matches the Chinese
 * convention of a week starting Monday, not the JS Date/Sunday-first default.
 * getDay() returns 0 for Sunday, so it needs its own offset (6 days back)
 * rather than fitting the same `day - 1` formula as the other weekdays.
 */
export function weekStartKey(date: Date = new Date()): string {
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(date);
  monday.setDate(date.getDate() - diff);
  return toDateKey(monday);
}

/**
 * `daysAgo(14)` as a Date, for "gte" query bounds — a thin wrapper so
 * `Date.now()` is called from a plain lib function rather than inline in a
 * Server Component's render body, which the react-hooks/purity rule (rightly)
 * flags as an impure call.
 */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
