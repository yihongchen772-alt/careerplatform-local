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
  /** 「具体时间另行通知」: the mail itself says no time yet, so nothing is missing. */
  waiting: boolean;
};

const BOOKED = /选择时间成功|预约(?:面试)?成功(?!后)|已(?:成功)?预约/;
const WAITING = /另行通知|后续通知|稍后通知|另行安排|另有通知|待通知|等待通知|时间(?:待定|未定)|具体时间[^。；;]{0,12}通知/;
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
      waiting: !time && WAITING.test(`${lines[0] ?? ""} ${evidenceOf(task.mailEventDraft)}`),
    });
  }
  // Ones with a time first, soonest first; then the rest, newest first (as sorted above).
  const withTime = rows.filter((row) => row.time).sort((a, b) => new Date(a.time!.startsAt).getTime() - new Date(b.time!.startsAt).getTime());
  return [...withTime, ...rows.filter((row) => !row.time)];
}

function evidenceOf(draft: unknown): string {
  const value = (draft as { evidence?: unknown } | null)?.evidence;
  return typeof value === "string" ? value : "";
}

const PENDING_WINDOW_MS = 45 * 86_400_000;

/**
 * A mail-made 待办 that 日历 is looking after (its 「邮件里的安排」 panel, or
 * the 接下来 list once written): 总览's 我的待办 leaves it out, so one mail is
 * never listed in two places. A mail the user took back (撤销) or an
 * ordinary 「回复 HR」 task is not covered and stays in the list.
 */
export function isCalendarMailTask(
  task: { title: string; mailEventDraft?: unknown; sourceMailKey?: string | null; done: boolean; mailEventId?: string | null; mailAppliedAt?: Date | null; mailUndoneAt?: Date | null; createdAt: Date },
  now: number
): boolean {
  if (task.done || !task.sourceMailKey || task.mailEventId || task.mailAppliedAt || task.mailUndoneAt) return false;
  if (task.createdAt.getTime() < now - PENDING_WINDOW_MS) return false;
  return EXAM_OR_INTERVIEW.test(task.title) || !!mailTime(task.mailEventDraft);
}
