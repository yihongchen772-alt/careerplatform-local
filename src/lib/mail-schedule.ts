import type { ApplicationStage, Prisma } from "@prisma/client";
import { confirmedWallTime, mailEventDraftSchema } from "@/lib/mail-calendar";
import { currentStageRow, isTerminalStage } from "@/lib/interview-schedule";
import {
  DEFAULT_REMIND_MINUTES,
  dayKeyIn,
  isValidTimeZone,
  loadSchedule,
  sameSchedule,
  scheduleOf,
  storeSchedule,
  syncApplicationEvents,
  systemTimeZone,
  type StageSchedule,
  type StoredSchedule,
} from "@/lib/stage-schedule";

/**
 * Interview and 笔试 times recognised in mail go straight onto the calendar:
 * onto the matched 投递's current step when there is one, otherwise as a
 * calendar item of their own. Each write is recorded on the mail's task so
 * the 自动更新 banner can show it and 撤销 can put things back.
 */

export type MailTime = {
  startsAt: Date;
  endsAt: Date | null;
  timeZone: string;
  meetingInfo: string | null;
  title: string;
  evidence: string;
};

export type MailUndo =
  | { kind: "stage"; stageHistoryId: string; written: StoredSchedule; previous: StoredSchedule }
  | { kind: "event"; eventId: string };

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

export type MailApplyResult =
  | { status: "stage"; applicationId: string; stageHistoryId: string }
  | { status: "event"; eventId: string }
  /** Already there (a reminder or a second copy of the same invitation). */
  | { status: "same" }
  /** The 投递 has a time the user typed; left for them to choose. */
  | { status: "conflict"; existing: Date }
  | { status: "skipped"; reason: "handled" | "no-time" | "past" | "missing" };

const taskSelect = {
  id: true,
  userId: true,
  title: true,
  note: true,
  mailEventDraft: true,
  mailEventId: true,
  mailAppliedAt: true,
  mailUndoneAt: true,
  applicationId: true,
  application: {
    select: {
      id: true,
      userId: true,
      currentStage: true,
      currentStageDate: true,
      stageHistory: { select: { id: true, stage: true, enteredAt: true, nextDeadline: true, nextDeadlineEnd: true, nextHasTime: true, meetingInfo: true, remindMinutes: true, scheduleSource: true } },
    },
  },
} satisfies Prisma.PersonalTaskSelect;

/**
 * Other mails about the same slot (a notice, a reminder, a change of room)
 * that were imported before and still wait: they are answered by this one.
 */
async function settleSiblings(tx: Prisma.TransactionClient, input: { userId: string; taskId: string; startsAt: Date; eventId: string | null; applicationId: string | null; titles: string[] }) {
  const waiting = await tx.personalTask.findMany({
    where: { userId: input.userId, id: { not: input.taskId }, done: false, mailEventId: null, mailAppliedAt: null, mailUndoneAt: null },
    select: { id: true, title: true, applicationId: true, mailEventDraft: true },
  });
  for (const sibling of waiting) {
    const time = mailTime(sibling.mailEventDraft);
    if (!time || time.startsAt.getTime() !== input.startsAt.getTime()) continue;
    const same = input.applicationId
      ? sibling.applicationId === input.applicationId
      : !sibling.applicationId && (input.titles.includes(sibling.title) || (!!time.title && input.titles.includes(time.title)));
    if (same) await tx.personalTask.update({ where: { id: sibling.id }, data: { mailEventId: input.eventId, done: true } });
  }
}

/**
 * Puts one mail's time on the calendar.
 *
 * - `stage`: the email's own reading of the step. A time for a different
 *   round than the 投递 is at (a late reminder about 一面 while it is at 二面)
 *   is not written onto the current step; it becomes its own calendar item.
 * - `force`: the user asked for it (「写入日程」) — a time they typed is
 *   replaced, and a past time is accepted.
 */
export async function applyMailSchedule(
  tx: Prisma.TransactionClient,
  input: { taskId: string; userId: string; stage?: ApplicationStage | null; force?: boolean; now?: Date }
): Promise<MailApplyResult> {
  const now = input.now ?? new Date();
  const task = await tx.personalTask.findFirst({ where: { id: input.taskId, userId: input.userId }, select: taskSelect });
  if (!task) return { status: "skipped", reason: "missing" };
  if (task.mailEventId || task.mailAppliedAt || (task.mailUndoneAt && !input.force)) return { status: "skipped", reason: "handled" };
  const time = mailTime(task.mailEventDraft);
  if (!time) return { status: "skipped", reason: "no-time" };
  if (!input.force && time.startsAt.getTime() <= now.getTime()) return { status: "skipped", reason: "past" };

  const app = task.application && task.application.userId === input.userId ? task.application : null;
  const row = app && !isTerminalStage(app.currentStage) && (!input.stage || input.stage === app.currentStage) ? currentStageRow(app, app.stageHistory) : undefined;
  if (app && row) {
    const current = scheduleOf(row);
    if (current.nextHasTime && current.nextDeadline?.getTime() === time.startsAt.getTime()) {
      // The same slot again: fill in a link the first mail lacked, nothing else.
      if (!current.meetingInfo && time.meetingInfo) {
        await tx.stageHistory.update({ where: { id: row.id }, data: { meetingInfo: time.meetingInfo } });
        await syncApplicationEvents(tx, app.id, now);
      }
      const copy = await tx.calendarEvent.findUnique({ where: { stageHistoryId: row.id }, select: { id: true } });
      await tx.personalTask.update({ where: { id: task.id }, data: { mailEventId: copy?.id ?? null, done: true } });
      return { status: "same" };
    }
    if (current.nextHasTime && current.scheduleSource !== "email" && !input.force) {
      return { status: "conflict", existing: current.nextDeadline! };
    }
    const written: StageSchedule = {
      nextDeadline: time.startsAt,
      nextDeadlineEnd: time.endsAt,
      nextHasTime: true,
      meetingInfo: time.meetingInfo ?? current.meetingInfo,
      remindMinutes: current.nextHasTime ? current.remindMinutes : DEFAULT_REMIND_MINUTES,
      scheduleSource: "email",
    };
    await tx.stageHistory.update({ where: { id: row.id }, data: written });
    await syncApplicationEvents(tx, app.id, now);
    const copy = await tx.calendarEvent.findUnique({ where: { stageHistoryId: row.id }, select: { id: true } });
    await settleSiblings(tx, { userId: input.userId, taskId: task.id, startsAt: time.startsAt, eventId: copy?.id ?? null, applicationId: app.id, titles: [] });
    const undo: MailUndo = { kind: "stage", stageHistoryId: row.id, written: storeSchedule(written), previous: storeSchedule(current) };
    await tx.personalTask.update({
      where: { id: task.id },
      // Written at the user's own request: nothing to point out afterwards.
      data: { mailAppliedAt: now, mailUndo: undo, mailAppliedSeenAt: input.force ? now : null, mailUndoneAt: null, mailEventId: copy?.id ?? null, done: true, applicationId: app.id },
    });
    return { status: "stage", applicationId: app.id, stageHistoryId: row.id };
  }

  // Several mails about one slot (a notice, a reminder, a change of room)
  // make one calendar item, not three.
  const title = (time.title || task.title).slice(0, 200);
  const sameSlot = await tx.calendarEvent.findMany({
    where: { userId: input.userId, stageHistoryId: null, startsAt: time.startsAt },
    select: { id: true, title: true },
  });
  for (const event of sameSlot) {
    const sibling = await tx.personalTask.findFirst({ where: { userId: input.userId, mailEventId: event.id, title: task.title }, select: { id: true } });
    if (event.title === title || sibling) {
      await tx.personalTask.update({ where: { id: task.id }, data: { mailEventId: event.id, done: true } });
      return { status: "same" };
    }
  }
  const remindAt = new Date(Math.max(time.startsAt.getTime() - DEFAULT_REMIND_MINUTES * 60_000, now.getTime()));
  const event = await tx.calendarEvent.create({
    data: {
      userId: input.userId,
      title,
      description: [time.meetingInfo, time.evidence, task.note].filter(Boolean).join("\n").slice(0, 20000),
      startsAt: time.startsAt,
      endsAt: time.endsAt,
      allDay: false,
      dateKey: dayKeyIn(time.startsAt, time.timeZone),
      timeZone: time.timeZone,
      meetingInfo: time.meetingInfo,
      source: "email",
      ...(time.startsAt.getTime() > now.getTime() ? { reminders: { create: { offsetMinutes: DEFAULT_REMIND_MINUTES, scheduledAt: remindAt } } } : {}),
    },
  });
  await settleSiblings(tx, { userId: input.userId, taskId: task.id, startsAt: time.startsAt, eventId: event.id, applicationId: null, titles: [task.title, title] });
  const undo: MailUndo = { kind: "event", eventId: event.id };
  await tx.personalTask.update({
    where: { id: task.id },
    data: { mailAppliedAt: now, mailUndo: undo, mailAppliedSeenAt: input.force ? now : null, mailUndoneAt: null, mailEventId: event.id, done: true },
  });
  return { status: "event", eventId: event.id };
}

function parseUndo(value: unknown): MailUndo | null {
  if (!value || typeof value !== "object") return null;
  const undo = value as Record<string, unknown>;
  if (undo.kind === "event" && typeof undo.eventId === "string") return { kind: "event", eventId: undo.eventId };
  if (undo.kind === "stage" && typeof undo.stageHistoryId === "string" && undo.written && undo.previous) {
    return { kind: "stage", stageHistoryId: undo.stageHistoryId, written: undo.written as StoredSchedule, previous: undo.previous as StoredSchedule };
  }
  return null;
}

/**
 * Takes one automatic write back. The step goes back to what it had —
 * unless the user has changed it since, in which case their version stays.
 * The mail goes back to the 待办 list, and is not applied again by itself.
 */
export async function undoMailScheduleWrite(tx: Prisma.TransactionClient, taskId: string, userId: string, now = new Date()): Promise<{ kept: boolean } | null> {
  const task = await tx.personalTask.findFirst({ where: { id: taskId, userId }, select: { id: true, mailAppliedAt: true, mailUndoneAt: true, mailUndo: true } });
  if (!task?.mailAppliedAt || task.mailUndoneAt) return null;
  const undo = parseUndo(task.mailUndo);
  let kept = false;
  if (undo?.kind === "stage") {
    const row = await tx.stageHistory.findFirst({
      where: { id: undo.stageHistoryId, application: { userId } },
      select: { id: true, applicationId: true, nextDeadline: true, nextDeadlineEnd: true, nextHasTime: true, meetingInfo: true, remindMinutes: true, scheduleSource: true, calendarEvent: { select: { id: true } } },
    });
    if (row) {
      if (sameSchedule(scheduleOf(row), loadSchedule(undo.written)) && row.scheduleSource === "email") {
        await tx.stageHistory.update({ where: { id: row.id }, data: loadSchedule(undo.previous) });
        await syncApplicationEvents(tx, row.applicationId, now);
        // Copies of the same mail no longer point at a time that is gone.
        if (row.calendarEvent) await tx.personalTask.updateMany({ where: { userId, mailEventId: row.calendarEvent.id }, data: { mailEventId: null } });
      } else {
        kept = true;
      }
    }
  } else if (undo?.kind === "event") {
    await tx.calendarEvent.deleteMany({ where: { id: undo.eventId, userId, stageHistoryId: null } });
    await tx.personalTask.updateMany({ where: { userId, mailEventId: undo.eventId }, data: { mailEventId: null } });
  }
  await tx.personalTask.update({ where: { id: task.id }, data: { mailUndoneAt: now, mailEventId: null, done: false } });
  return { kept };
}
