export type EmailReminderSchedule = { enabled: boolean; time: string; timeZone: string };

export function validReminderTimeZone(timeZone: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); return true; } catch { return false; }
}

/** Use the saved zone, including DST, rather than the Node server's zone. */
export function dueEmailReminderDay(schedule: EmailReminderSchedule, now = new Date()): string | null {
  if (!schedule.enabled || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time) || !validReminderTimeZone(schedule.timeZone)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (key: string) => parts.find((p) => p.type === key)?.value;
  if (`${part("hour")}:${part("minute")}` < schedule.time) return null;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
