import { confirmedWallTime, mailEventDraftSchema } from "@/lib/mail-calendar";
import { isValidTimeZone, systemTimeZone } from "@/lib/stage-schedule";

/** The time an invitation mail names (or a 笔试 / 测评 cut-off), read from its recognised draft. */
export type MailTime = {
  /** A booked time; or, when hasTime is false, UTC midnight of the day (a deadline). */
  startsAt: Date;
  endsAt: Date | null;
  hasTime: boolean;
  timeZone: string;
  meetingInfo: string | null;
  title: string;
  evidence: string;
  /** The date is the last day to pick an interview slot, not the interview. */
  booking: boolean;
  /** A cut-off with its clock time (「11 月 11 日 17:00 前」): the moment it is over. */
  deadlineAt?: Date | null;
  accessCode?: string;
  actionRequired?: string;
  actionDeadline?: string;
};

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DAY = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/;

function utcDay(key: string): Date | null {
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key ? null : date;
}

/**
 * The time in a recognised draft, or null when it has no clear date and
 * clock time. Mail rarely names a timezone; it is then this machine's own
 * (an invitation to you is written in your time).
 */
export function mailTime(draft: unknown, fallbackZone = systemTimeZone()): MailTime | null {
  const parsed = mailEventDraftSchema.safeParse(draft);
  if (!parsed.success) return null;
  const value = parsed.data;
  const code = value.accessCode.trim();
  const baseText = `${value.location} ${value.meetingUrl}`;
  const codeNote = code && !baseText.includes(code) ? `口令：${code}` : "";
  const meetingInfoOf = (extra = "") => [value.location.trim(), value.meetingUrl.trim(), codeNote, extra].filter(Boolean).join(" ").slice(0, 2000) || null;
  if (!LOCAL_TIME.test(value.localStart)) {
    // A 笔试 / 测评 with a cut-off (and maybe an opening day) instead of a slot:
    // a date-only step, its window from windowStart to the deadline.
    const deadline = DAY.exec(value.deadline.trim());
    if (!deadline) return null;
    let last = utcDay(deadline[1]);
    if (!last) return null;
    // 「24 点截止」 read as 00:00 the next day is the end of this one.
    const atMidnight = deadline[2] === "00:00";
    if (atMidnight) last = new Date(last.getTime() - 86_400_000);
    const opening = DAY.exec(value.windowStart.trim());
    const first = opening ? utcDay(opening[1]) : null;
    const windowed = !!first && first.getTime() < last.getTime();
    const zone = isValidTimeZone(value.timeZone.trim()) ? value.timeZone.trim() : fallbackZone;
    let deadlineAt: Date | null = null;
    if (deadline[2] && !atMidnight) {
      try {
        deadlineAt = confirmedWallTime(`${deadline[1]}T${deadline[2]}`, zone);
      } catch {
        deadlineAt = null;
      }
    }
    return {
      startsAt: windowed ? first! : last,
      endsAt: windowed ? last : null,
      hasTime: false,
      timeZone: zone,
      deadlineAt,
      meetingInfo: meetingInfoOf(atMidnight ? "截止 24:00" : deadline[2] ? `截止 ${deadline[2]}` : ""),
      title: value.title.trim(),
      evidence: value.evidence.trim(),
      booking: value.booking,
      ...(code ? { accessCode: code } : {}),
      ...(value.actionRequired.trim() ? { actionRequired: value.actionRequired.trim() } : {}),
      ...(value.actionDeadline.trim() ? { actionDeadline: value.actionDeadline.trim() } : {}),
    };
  }
  const zone = isValidTimeZone(value.timeZone.trim()) ? value.timeZone.trim() : fallbackZone;
  let startsAt: Date;
  try {
    startsAt = confirmedWallTime(value.localStart, zone);
  } catch {
    return null;
  }
  let endsAt: Date | null = null;
  if (LOCAL_TIME.test(value.localEnd)) {
    try {
      const end = confirmedWallTime(value.localEnd, zone);
      if (end.getTime() > startsAt.getTime()) endsAt = end;
    } catch {
      endsAt = null;
    }
  }
  return {
    startsAt,
    endsAt,
    hasTime: true,
    timeZone: zone,
    meetingInfo: meetingInfoOf(),
    title: value.title.trim(),
    evidence: value.evidence.trim(),
    booking: false,
    ...(code ? { accessCode: code } : {}),
    ...(value.actionRequired.trim() ? { actionRequired: value.actionRequired.trim() } : {}),
    ...(value.actionDeadline.trim() ? { actionDeadline: value.actionDeadline.trim() } : {}),
  };
}

/** Parses an action deadline string (YYYY-MM-DD or YYYY-MM-DDTHH:mm) into a Date for PersonalTask.dueDate. */
export function parseActionDeadlineDate(raw: string | null | undefined, fallbackZone = systemTimeZone()): Date | null {
  const clean = (raw ?? "").trim();
  const match = DAY.exec(clean);
  if (!match) return null;
  if (match[2]) {
    try {
      return confirmedWallTime(`${match[1]}T${match[2]}`, isValidTimeZone(fallbackZone) ? fallbackZone : "UTC");
    } catch {
      return utcDay(match[1]);
    }
  }
  return utcDay(match[1]);
}

/**
 * Extracts passcode / action item metadata from mailEventDraft and/or the
 * task note lines appended by inbox-scan (`待办：...`, `口令：...`).
 */
export function mailDraftMeta(
  draft: unknown,
  note?: string | null,
): { accessCode: string; actionRequired: string; actionDeadline: string; meetingInfo: string | null } {
  const parsed = mailEventDraftSchema.safeParse(draft);
  const val = parsed.success ? parsed.data : null;
  const noteLines = (note ?? "").split("\n").map((l) => l.trim());
  const codeLine = noteLines.find((l) => l.startsWith("口令："))?.slice(3).trim() ?? "";
  const actionLine = noteLines.find((l) => l.startsWith("待办："))?.slice(3).trim() ?? "";
  const actionMatch = actionLine ? /^(.*?)(?:（截止\s*(.+?)）)?$/.exec(actionLine) : null;
  const accessCode = val?.accessCode.trim() || codeLine;
  const actionRequired = val?.actionRequired.trim() || actionMatch?.[1]?.trim() || "";
  const actionDeadline = val?.actionDeadline.trim() || actionMatch?.[2]?.trim() || val?.deadline.trim() || "";
  const meetingInfo =
    [val?.location.trim(), val?.meetingUrl.trim(), accessCode ? `口令：${accessCode}` : ""]
      .filter(Boolean)
      .join(" ")
      .slice(0, 2000) || null;
  return { accessCode, actionRequired, actionDeadline, meetingInfo };
}

/** The last moment a mail time still matters: the slot's start, or the end of a deadline's last day. */
export function mailTimeOver(time: MailTime): number {
  if (time.hasTime) return time.startsAt.getTime();
  if (time.deadlineAt) return time.deadlineAt.getTime();
  return (time.endsAt ?? time.startsAt).getTime() + 86_400_000;
}
