import { mailTime, mailTimeOver } from "@/lib/mail-time";
import { EXAM_OR_INTERVIEW } from "@/lib/mail-time-extract";

/**
 * The mail-made 待办 that still wait to get onto the calendar: a time the
 * mail names but nothing has written yet, and the mail that names none.
 */
export type PendingTask = {
  id: string;
  title: string;
  note: string | null;
  mailEventDraft: unknown;
  applicationId: string | null;
  createdAt: Date;
};

export type PendingRow = {
  id: string;
  type: string;
  company: string | null;
  summary: string;
  subject: string | null;
  draft: unknown;
  time: { startsAt: string; hasTime: boolean; booking: boolean } | null;
  evidence: string | null;
  /** 「预约面试成功」: a slot is booked, but the mail does not say which. */
  booked: boolean;
};

const BOOKED = /选择时间成功|预约(?:面试)?成功|已(?:成功)?预约/;
const MAIL_TITLE = /^([^：]+)：(.+)$/;

/**
 * `scheduledApps`: 投递 that already have a time ahead. A mail without a time
 * for one of them is an older notice of the same round, not a gap.
 */
export function pendingMailRows(tasks: PendingTask[], now: number, scheduledApps: Set<string>): PendingRow[] {
  const rows: PendingRow[] = [];
  const seenNoTime = new Set<string>();
  for (const task of [...tasks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const time = mailTime(task.mailEventDraft);
    if (!EXAM_OR_INTERVIEW.test(task.title) && !time) continue;
    if (time && mailTimeOver(time) <= now) continue;
    const parts = MAIL_TITLE.exec(task.title);
    const company = parts?.[2]?.trim() || null;
    if (!time) {
      if (task.applicationId && scheduledApps.has(task.applicationId)) continue;
      // Several notices from one company without a time: the newest speaks for them.
      const key = company ?? task.title;
      if (seenNoTime.has(key)) continue;
      seenNoTime.add(key);
    }
    const lines = (task.note ?? "").split("\n").map((line) => line.trim());
    rows.push({
      id: task.id,
      type: parts?.[1]?.trim() || task.title,
      company,
      summary: lines[0] ?? "",
      subject: lines.find((line) => line.startsWith("邮件主题："))?.slice(5) ?? null,
      draft: task.mailEventDraft ?? null,
      time: time ? { startsAt: time.startsAt.toISOString(), hasTime: time.hasTime, booking: time.booking } : null,
      evidence: time?.evidence || null,
      booked: !time && BOOKED.test(`${task.title} ${lines[0] ?? ""} ${lines.find((line) => line.startsWith("邮件主题：")) ?? ""}`),
    });
  }
  // Ones with a time first, soonest first; then the rest, newest first (as sorted above).
  const withTime = rows.filter((row) => row.time).sort((a, b) => new Date(a.time!.startsAt).getTime() - new Date(b.time!.startsAt).getTime());
  return [...withTime, ...rows.filter((row) => !row.time)];
}
