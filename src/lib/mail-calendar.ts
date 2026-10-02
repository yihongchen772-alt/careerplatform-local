import { z } from "zod";
export const mailEventDraftSchema = z.object({ title: z.string().max(200).default(""), localStart: z.string().max(50).default(""), localEnd: z.string().max(50).default(""), timeZone: z.string().max(100).default(""), location: z.string().max(1000).default(""), meetingUrl: z.string().max(2000).default(""), evidence: z.string().max(2000).default("") });
export type MailEventDraft = z.infer<typeof mailEventDraftSchema>;
/** Convert a user-confirmed wall time, then round-trip to reject DST gaps/invalid dates. */
export function confirmedWallTime(local: string, zone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("请输入完整的日期和时间");
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const target = Date.parse(`${local}:00Z`); if (!Number.isFinite(target)) throw new Error("日期无效");
  let utc = target;
  const partsAt = (ms: number) => Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  for (let i = 0; i < 4; i++) { const p = partsAt(utc); const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`); const delta = target - represented; utc += delta; if (!delta) break; }
  const p = partsAt(utc); if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` !== local) throw new Error("此时间不存在，请核对日期或夏令时");
  // Ambiguous clocks require an explicit UTC offset rather than silently choosing one.
  for (const offset of [-3600000, 3600000, -1800000, 1800000]) { const other = partsAt(utc + offset); if (`${other.year}-${other.month}-${other.day}T${other.hour}:${other.minute}` === local) throw new Error("此时间处于夏令时重复区间，请先换算成 UTC 并选择 UTC 时区"); }
  return new Date(utc);
}
export function parseCalendarInvite(text: string): MailEventDraft | null {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/); const start = lines.findIndex((l) => l === "BEGIN:VEVENT"); if (start < 0) return null;
  const event = lines.slice(start + 1, lines.indexOf("END:VEVENT", start) < 0 ? undefined : lines.indexOf("END:VEVENT", start));
  const get = (key: string) => event.find((l) => l.startsWith(`${key}:`) || l.startsWith(`${key};`)) || "";
  const decode = (line: string) => line.slice(line.indexOf(":") + 1).replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  const date = (line: string) => { const raw = decode(line); const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}(Z)?$/.exec(raw); return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}` : ""; };
  const rawStart = get("DTSTART"); const timezone = /;TZID=([^;:]+)/.exec(rawStart)?.[1]?.replace(/^"|"$/g, "") || (/Z$/.test(rawStart) ? "UTC" : "");
  const description = decode(get("DESCRIPTION")); const url = decode(get("URL")) || description.match(/https?:\/\/[^\s<>]+/)?.[0] || "";
  return mailEventDraftSchema.parse({ title: decode(get("SUMMARY")), localStart: date(rawStart), localEnd: date(get("DTEND")), timeZone: timezone, location: decode(get("LOCATION")), meetingUrl: url.slice(0, 2000), evidence: `邮件日历邀请：${decode(rawStart)}${get("STATUS") ? `；${decode(get("STATUS"))}` : ""}` });
}
