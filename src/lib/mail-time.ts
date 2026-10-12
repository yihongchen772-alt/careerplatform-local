import { confirmedWallTime, mailEventDraftSchema } from "@/lib/mail-calendar";
import { isValidTimeZone, systemTimeZone } from "@/lib/stage-schedule";

/** The time an invitation mail names, read from its recognised draft. */
export type MailTime = {
  startsAt: Date;
  endsAt: Date | null;
  timeZone: string;
  meetingInfo: string | null;
  title: string;
  evidence: string;
};

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * The time in a recognised draft, or null when it has no clear date and
 * clock time. Mail rarely names a timezone; it is then this machine's own
 * (an invitation to you is written in your time).
 */
export function mailTime(draft: unknown, fallbackZone = systemTimeZone()): MailTime | null {
  const parsed = mailEventDraftSchema.safeParse(draft);
  if (!parsed.success) return null;
  const value = parsed.data;
  if (!LOCAL_TIME.test(value.localStart)) return null;
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
  const meetingInfo = [value.location.trim(), value.meetingUrl.trim()].filter(Boolean).join(" ").slice(0, 2000) || null;
  return { startsAt, endsAt, timeZone: zone, meetingInfo, title: value.title.trim(), evidence: value.evidence.trim() };
}
