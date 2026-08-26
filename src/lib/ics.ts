/**
 * Minimal RFC 5545 (iCalendar) writer for exporting deadlines/tasks to the
 * system calendar app — no library needed for something this small, and it
 * keeps the dependency list at zero for a feature that's just text
 * generation. All-day events only (VALUE=DATE): every deadline in this app
 * is a calendar day, never a specific clock time, so this deliberately
 * doesn't do timed VEVENTs.
 */

type IcsEvent = {
  id: string;
  date: string;
  dateEnd: string | null;
  label: string;
};

/** YYYYMMDD from an ISO date string, in the viewer's local calendar day —
 * matches how these dates are entered (a <input type="date"> value), not
 * shifted to UTC. */
function toIcsDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** DTEND for an all-day event is exclusive per RFC 5545 — a one-day event
 * spanning just "today" still needs DTEND = tomorrow, or calendar apps
 * render it as zero-length. */
function toIcsDateExclusiveEnd(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** RFC 5545 requires folding lines longer than 75 octets, continuing with
 * CRLF + a single space. Chinese labels can hit that in UTF-8 byte terms
 * well before 75 *characters*, so this counts bytes, not chars. */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte UTF-8 character across chunks.
    while (end < bytes.length && (bytes[end] & 0b11000000) === 0b10000000) end--;
    chunks.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
    limit = 74; // continuation lines lose one octet to the leading space
  }
  return chunks.join("\r\n ");
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function toIcs(events: IcsEvent[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//求职罗盘//JobCompass//ZH",
    "CALSCALE:GREGORIAN",
  ];

  const now = stamp();
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@jobcompass.local`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${toIcsDate(e.date)}`,
      `DTEND;VALUE=DATE:${toIcsDateExclusiveEnd(e.dateEnd ?? e.date)}`,
      `SUMMARY:${escapeIcsText(e.label)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function downloadIcs(filename: string, ics: string) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
