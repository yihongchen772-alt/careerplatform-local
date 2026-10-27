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
  const meetingInfoOf = (extra = "") => [value.location.trim(), value.meetingUrl.trim(), extra].filter(Boolean).join(" ").slice(0, 2000) || null;
  if (!LOCAL_TIME.test(value.localStart)) {
    // A 笔试 / 测评 with a cut-off (and maybe an opening day) instead of a slot:
    // a date-only step, its window from windowStart to the deadline.
    const deadline = DAY.exec(value.deadline.trim());
    if (!deadline) return null;
    const last = utcDay(deadline[1]);
    if (!last) return null;
    const opening = DAY.exec(value.windowStart.trim());
    const first = opening ? utcDay(opening[1]) : null;
    const windowed = !!first && first.getTime() < last.getTime();
    return {
      startsAt: windowed ? first! : last,
      endsAt: windowed ? last : null,
      hasTime: false,
      timeZone: isValidTimeZone(value.timeZone.trim()) ? value.timeZone.trim() : fallbackZone,
      meetingInfo: meetingInfoOf(deadline[2] ? `截止 ${deadline[2]}` : ""),
      title: value.title.trim(),
      evidence: value.evidence.trim(),
      booking: value.booking,
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
  return { startsAt, endsAt, hasTime: true, timeZone: zone, meetingInfo: meetingInfoOf(), title: value.title.trim(), evidence: value.evidence.trim(), booking: false };
}

/** The last moment a mail time still matters: the slot's start, or the end of a deadline's last day. */
export function mailTimeOver(time: MailTime): number {
  if (time.hasTime) return time.startsAt.getTime();
  return (time.endsAt ?? time.startsAt).getTime() + 86_400_000;
}
