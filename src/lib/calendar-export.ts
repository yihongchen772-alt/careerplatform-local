export type ExportCalendarEvent = { id: string; title: string; startsAt: Date; endsAt?: Date | null; description?: string | null; allDay?: boolean; dateKey?: string; offsetMinutes?: number | null };
const text = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r/g, "");
const utc = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
function fold(line: string) { const lines: string[] = []; let chunk = ""; for (const char of line) { if (Buffer.byteLength(chunk + char, "utf8") > 75) { lines.push(chunk); chunk = " "; } chunk += char; } lines.push(chunk); return lines.join("\r\n"); }
export function buildCalendarIcs(events: ExportCalendarEvent[], now = new Date()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//JobCompass//Career Calendar//ZH", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${text(e.id)}@jobcompass.local`, `DTSTAMP:${utc(now)}`, `SUMMARY:${text(e.title)}`, `DESCRIPTION:${text(e.description || "")}`);
    if (e.allDay && e.dateKey) { lines.push(`DTSTART;VALUE=DATE:${e.dateKey.replace(/-/g, "")}`); const end = new Date(`${e.dateKey}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1); lines.push(`DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, "")}`); }
    else { lines.push(`DTSTART:${utc(e.startsAt)}`); if (e.endsAt) lines.push(`DTEND:${utc(e.endsAt)}`); }
    if (e.offsetMinutes !== undefined && e.offsetMinutes !== null) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(e.title)}`, `TRIGGER:-PT${e.offsetMinutes}M`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR"); return lines.map(fold).join("\r\n") + "\r\n";
}
