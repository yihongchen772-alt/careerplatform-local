import type { Prisma } from "@prisma/client";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { isTerminalStage } from "@/lib/interview-schedule";

/**
 * A 投递 step's time (面试 at 14:00, 笔试 by 10/21) lives on its stage row.
 * A step with a clock time also gets a calendar copy, which is what puts it
 * in 日历 and sends its reminder. The copy is derived: whatever changes the
 * row (a form, an undo, an email) ends with syncApplicationEvents, and
 * nothing edits the copy on its own.
 */

export const DEFAULT_REMIND_MINUTES = 30;
export const REMIND_CHOICES = [0, 15, 30, 60, 120, 1440] as const;

export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** `YYYY-MM-DD` of a moment as seen in `timeZone`. */
export function dayKeyIn(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export type StageSchedule = {
  nextDeadline: Date | null;
  nextDeadlineEnd: Date | null;
  nextHasTime: boolean;
  meetingInfo: string | null;
  remindMinutes: number | null;
  scheduleSource: string | null;
};

/** JSON-safe copy, for the undo record. */
export type StoredSchedule = {
  nextDeadline: string | null;
  nextDeadlineEnd: string | null;
  nextHasTime: boolean;
  meetingInfo: string | null;
  remindMinutes: number | null;
  scheduleSource: string | null;
};

export function scheduleOf(row: StageSchedule): StageSchedule {
  return {
    nextDeadline: row.nextDeadline,
    nextDeadlineEnd: row.nextDeadlineEnd,
    nextHasTime: !!row.nextHasTime,
    meetingInfo: row.meetingInfo,
    remindMinutes: row.remindMinutes,
    scheduleSource: row.scheduleSource,
  };
}

export function storeSchedule(schedule: StageSchedule): StoredSchedule {
  return {
    nextDeadline: schedule.nextDeadline?.toISOString() ?? null,
    nextDeadlineEnd: schedule.nextDeadlineEnd?.toISOString() ?? null,
    nextHasTime: schedule.nextHasTime,
    meetingInfo: schedule.meetingInfo,
    remindMinutes: schedule.remindMinutes,
    scheduleSource: schedule.scheduleSource,
  };
}

export function loadSchedule(stored: StoredSchedule): StageSchedule {
  return {
    nextDeadline: stored.nextDeadline ? new Date(stored.nextDeadline) : null,
    nextDeadlineEnd: stored.nextDeadlineEnd ? new Date(stored.nextDeadlineEnd) : null,
    nextHasTime: !!stored.nextHasTime,
    meetingInfo: stored.meetingInfo ?? null,
    remindMinutes: stored.remindMinutes ?? null,
    scheduleSource: stored.scheduleSource ?? null,
  };
}

/** Same time, end, place and reminder — who wrote it does not matter. */
export function sameSchedule(left: StageSchedule, right: StageSchedule): boolean {
  const time = (value: Date | null) => value?.getTime() ?? null;
  return time(left.nextDeadline) === time(right.nextDeadline)
    && time(left.nextDeadlineEnd) === time(right.nextDeadlineEnd)
    && left.nextHasTime === right.nextHasTime
    && (left.meetingInfo ?? null) === (right.meetingInfo ?? null)
    && (left.remindMinutes ?? null) === (right.remindMinutes ?? null);
}

/**
 * Normalises what a form or an email hands over: no time without a day, no
 * end before the start, no reminder for a day without a clock time.
 */
export function cleanSchedule(input: {
  nextDeadline?: Date | null;
  nextDeadlineEnd?: Date | null;
  nextHasTime?: boolean | null;
  meetingInfo?: string | null;
  remindMinutes?: number | null;
}): Omit<StageSchedule, "scheduleSource"> {
  const start = input.nextDeadline && !Number.isNaN(input.nextDeadline.getTime()) ? input.nextDeadline : null;
  const hasTime = !!(start && input.nextHasTime);
  let end = start && input.nextDeadlineEnd && !Number.isNaN(input.nextDeadlineEnd.getTime()) ? input.nextDeadlineEnd : null;
  if (end && start && end.getTime() < start.getTime()) end = null;
  if (end && start && hasTime && end.getTime() === start.getTime()) end = null;
  const meetingInfo = input.meetingInfo?.trim().slice(0, 2000) || null;
  const remind = input.remindMinutes === undefined ? DEFAULT_REMIND_MINUTES : input.remindMinutes;
  return {
    nextDeadline: start,
    nextDeadlineEnd: end,
    nextHasTime: hasTime,
    meetingInfo,
    remindMinutes: hasTime && remind !== null && Number.isInteger(remind) && remind >= 0 ? Math.min(remind, 10080) : null,
  };
}

/**
 * Brings every timed step's calendar copy and reminder in line with the
 * application. A closed application keeps its past events in the calendar
 * but sends no more reminders.
 */
export async function syncApplicationEvents(tx: Prisma.TransactionClient, applicationId: string, now = new Date()): Promise<void> {
  const app = await tx.application.findUnique({
    where: { id: applicationId },
    select: {
      userId: true,
      title: true,
      currentStage: true,
      company: { select: { name: true } },
      stageHistory: {
        select: {
          id: true,
          stage: true,
          stageLabel: true,
          nextDeadline: true,
          nextDeadlineEnd: true,
          nextHasTime: true,
          meetingInfo: true,
          remindMinutes: true,
          completedAt: true,
          calendarEvent: { select: { id: true, title: true, description: true, startsAt: true, endsAt: true, dateKey: true, timeZone: true, meetingInfo: true, reminders: true } },
        },
      },
    },
  });
  if (!app) return;
  const closed = isTerminalStage(app.currentStage);
  const timeZone = systemTimeZone();
  for (const row of app.stageHistory) {
    const event = row.calendarEvent;
    if (!row.nextHasTime || !row.nextDeadline) {
      if (event) await tx.calendarEvent.delete({ where: { id: event.id } });
      continue;
    }
    const start = row.nextDeadline;
    const end = row.nextDeadlineEnd && row.nextDeadlineEnd.getTime() > start.getTime() ? row.nextDeadlineEnd : null;
    const data = {
      title: `${app.company.name} · ${row.stageLabel?.trim() || STAGE_LABELS[row.stage]}`.slice(0, 200),
      description: [app.title, row.meetingInfo?.trim()].filter(Boolean).join("\n"),
      startsAt: start,
      endsAt: end,
      allDay: false,
      dateKey: dayKeyIn(start, timeZone),
      timeZone,
      meetingInfo: row.meetingInfo?.trim() || null,
    };
    let eventId: string;
    const reminder = event?.reminders[0] ?? null;
    const startChanged = !event || event.startsAt.getTime() !== start.getTime();
    if (!event) {
      eventId = (await tx.calendarEvent.create({ data: { ...data, userId: app.userId, stageHistoryId: row.id } })).id;
    } else {
      eventId = event.id;
      const changed = startChanged || event.title !== data.title || event.description !== data.description
        || (event.endsAt?.getTime() ?? null) !== (end?.getTime() ?? null) || event.dateKey !== data.dateKey || event.timeZone !== data.timeZone || (event.meetingInfo ?? null) !== data.meetingInfo;
      if (changed) await tx.calendarEvent.update({ where: { id: event.id }, data: { ...data, revision: { increment: 1 } } });
    }

    // No reminder for a closed application, for a step already under way
    // or marked done (测评 finished early), or when the applicant chose
    // none. One that is due already (a slot fifteen minutes away with a
    // 30-minute reminder) goes out right away.
    const offset = row.remindMinutes;
    const wanted = !closed && !row.completedAt && offset !== null && offset >= 0 && start.getTime() > now.getTime();
    if (!wanted) {
      // A reminder already shown for a past step stays as its record.
      if (reminder && (closed || row.completedAt || offset === null || !reminder.deliveredAt)) await tx.eventReminder.delete({ where: { id: reminder.id } });
      continue;
    }
    const scheduledAt = new Date(Math.max(start.getTime() - offset * 60_000, now.getTime()));
    if (!reminder) {
      await tx.eventReminder.create({ data: { eventId, offsetMinutes: offset, scheduledAt } });
    } else if (reminder.offsetMinutes !== offset || startChanged) {
      // Only a new time or offset re-arms it: saving the step again for
      // any other reason must not repeat a notification already shown.
      await tx.eventReminder.update({ where: { id: reminder.id }, data: { offsetMinutes: offset, scheduledAt, deliveredAt: null, claimUntil: null, claimToken: null } });
    }
  }
}
