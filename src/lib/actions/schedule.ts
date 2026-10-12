"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type ApplicationStage } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { resyncCurrentStage } from "@/lib/application-stage-history";
import { cleanSchedule, sameSchedule, scheduleOf, syncApplicationEvents } from "@/lib/stage-schedule";
import { applyMailSchedule, undoMailScheduleWrite } from "@/lib/mail-schedule";
import { currentStageRow, isTerminalStage, overlapping, scheduleStageChoices, targetStageFor } from "@/lib/interview-schedule";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { rowForSchedule } from "@/lib/schedule-target";
import { terminationFields } from "@/lib/termination";
import { deleteApplicationsFor } from "@/lib/application-delete";
import { applicationStageValues } from "@/lib/validation";

function revalidate(applicationIds: (string | null | undefined)[] = []) {
  revalidatePath("/applications");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  for (const id of new Set(applicationIds)) if (id) revalidatePath(`/applications/${id}`);
}

const scheduleInput = z.object({
  nextDeadline: z.coerce.date().nullable(),
  nextDeadlineEnd: z.coerce.date().nullable().optional(),
  nextHasTime: z.boolean(),
  meetingInfo: z.string().trim().max(2000, "会议信息不能超过 2000 字").nullable().optional(),
  remindMinutes: z.number().int().min(0).max(10080).nullable().optional(),
});

/**
 * Sets just the time / place of one step — 「添加面试时间」 on a 投递's page,
 * without recording a new stage.
 */
export async function setStageSchedule(stageHistoryId: string, input: z.input<typeof scheduleInput>): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = scheduleInput.safeParse(input);
    if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "时间格式不对");
    const row = await db.stageHistory.findFirst({ where: { id: stageHistoryId, application: { userId: user.id } } });
    if (!row) throw new UserFacingError("这条进度记录已不存在，请刷新");
    const schedule = cleanSchedule(parsed.data);
    const retimed = !sameSchedule({ ...schedule, scheduleSource: null }, scheduleOf(row));
    await db.$transaction(async (tx) => {
      await tx.stageHistory.update({ where: { id: row.id }, data: { ...schedule, ...(retimed ? { scheduleSource: null } : {}) } });
      await syncApplicationEvents(tx, row.applicationId);
    });
    revalidate([row.applicationId]);
    return null;
  });
}

/**
 * 「添加面试时间」: a time for a round the user picked. On the current step
 * when it is that round, otherwise on a new step for it (the 投递 moves
 * forward, with 撤销 in the toast).
 */
export async function addStageSchedule(applicationId: string, stage: string, input: z.input<typeof scheduleInput>): Promise<ActionResult<{ stageHistoryId: string; created: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = scheduleInput.safeParse(input);
    if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]?.message ?? "时间格式不对");
    const app = await db.application.findFirst({ where: { id: applicationId, userId: user.id }, select: { id: true, currentStage: true } });
    if (!app) throw new UserFacingError("这条投递已经不在了，请刷新");
    if (isTerminalStage(app.currentStage)) throw new UserFacingError("这条投递已经结束");
    const round = z.enum(applicationStageValues).safeParse(stage);
    if (!round.success || (round.data !== app.currentStage && !scheduleStageChoices(app.currentStage).includes(round.data))) throw new UserFacingError("请选择是哪一轮");
    const schedule = cleanSchedule(parsed.data);
    const result = await db.$transaction(async (tx) => {
      const placed = await rowForSchedule(tx, app.id, round.data, { kind: "manual" });
      if (!placed) throw new UserFacingError("这条投递没有进度记录");
      await tx.stageHistory.update({ where: { id: placed.rowId }, data: { ...schedule, scheduleSource: null } });
      await syncApplicationEvents(tx, app.id);
      return { stageHistoryId: placed.rowId, created: placed.created };
    });
    revalidate([app.id]);
    return result;
  });
}

/** 「我已完成 / 我已面完」 on a step, or taking that back. */
export async function setStepCompleted(stageHistoryId: string, done: boolean): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = await db.stageHistory.findFirst({ where: { id: stageHistoryId, application: { userId: user.id } }, select: { id: true, applicationId: true } });
    if (!row) throw new UserFacingError("这条进度记录已不存在，请刷新");
    await db.$transaction(async (tx) => {
      await tx.stageHistory.update({ where: { id: row.id }, data: { completedAt: done ? new Date() : null, ...(done ? {} : { followedUpAt: null }) } });
      // Done early: a reminder for its slot is no longer wanted.
      await syncApplicationEvents(tx, row.applicationId);
    });
    revalidate([row.applicationId]);
    return null;
  });
}

/** The few lines written right after an interview (they feed 面经库). */
export async function saveStepNote(stageHistoryId: string, note: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const text = z.string().max(20000, "复盘太长了，先精简到 2 万字以内").safeParse(note);
    if (!text.success) throw new UserFacingError(text.error.issues[0]?.message ?? "内容不对");
    const row = await db.stageHistory.findFirst({ where: { id: stageHistoryId, application: { userId: user.id } }, select: { id: true, applicationId: true } });
    if (!row) throw new UserFacingError("这条进度记录已不存在，请刷新");
    await db.stageHistory.update({ where: { id: row.id }, data: { note: text.data.trim() || null } });
    revalidate([row.applicationId]);
    revalidatePath("/interviews");
    return null;
  });
}

/** 「已跟进」: the 该跟进了 nudge rests for another while. */
export async function markFollowedUp(stageHistoryId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = await db.stageHistory.findFirst({ where: { id: stageHistoryId, application: { userId: user.id } }, select: { id: true, applicationId: true } });
    if (!row) throw new UserFacingError("这条进度记录已不存在，请刷新");
    await db.stageHistory.update({ where: { id: row.id }, data: { followedUpAt: new Date() } });
    revalidate([row.applicationId]);
    return null;
  });
}

/**
 * Booked times that overlap [start, end) — for the 撞期 warning while a
 * time is being typed. Steps of open 投递 and calendar items from mail.
 */
export async function scheduleConflicts(start: string, end: string | null, excludeRowId: string | null): Promise<{ label: string; startsAt: string; endsAt: string | null; applicationId: string | null }[]> {
  const user = await requireUser();
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return [];
  const to = end ? new Date(end) : null;
  const window = { gte: new Date(from.getTime() - 86_400_000), lte: new Date(from.getTime() + 86_400_000) };
  const [rows, events] = await Promise.all([
    db.stageHistory.findMany({
      where: { nextHasTime: true, nextDeadline: window, completedAt: null, application: { userId: user.id, currentStage: { notIn: ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"] } }, ...(excludeRowId ? { id: { not: excludeRowId } } : {}) },
      select: { id: true, stage: true, stageLabel: true, nextDeadline: true, nextDeadlineEnd: true, application: { select: { id: true, company: { select: { name: true } } } } },
    }),
    db.calendarEvent.findMany({ where: { userId: user.id, stageHistoryId: null, allDay: false, startsAt: window }, select: { id: true, title: true, startsAt: true, endsAt: true } }),
  ]);
  const slots = [
    ...rows.map((row) => ({ key: `stage:${row.id}`, startsAt: row.nextDeadline!.toISOString(), endsAt: row.nextDeadlineEnd?.toISOString() ?? null, label: `${row.application.company.name} · ${row.stageLabel || STAGE_LABELS[row.stage]}`, applicationId: row.application.id })),
    ...events.map((event) => ({ key: `event:${event.id}`, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt?.toISOString() ?? null, label: event.title, applicationId: null })),
  ];
  const hits = new Set(overlapping(slots, from, to && !Number.isNaN(to.getTime()) ? to : null).map((slot) => slot.key));
  return slots.filter((slot) => hits.has(slot.key)).map(({ label, startsAt, endsAt, applicationId }) => ({ label, startsAt, endsAt, applicationId }));
}

/** 「写入日程」 on a recognised time: onto its 投递 (replacing a typed time) or the calendar. */
export async function writeMailSchedule(taskId: string): Promise<ActionResult<{ applicationId: string | null; placed: "stage" | "event" | "same" }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const result = await db.$transaction((tx) => applyMailSchedule(tx, { taskId, userId: user.id, force: true }));
    if (result.status === "skipped") {
      throw new UserFacingError(result.reason === "no-time" ? "邮件里没有识别出明确的日期和时间，请在「总览 → 我的日程」里核对后填写" : "这条邮件日程已经处理过了，请刷新");
    }
    if (result.status === "conflict") throw new UserFacingError("请刷新后重试");
    revalidate([result.status === "stage" ? result.applicationId : null]);
    return { applicationId: result.status === "stage" ? result.applicationId : null, placed: result.status };
  });
}

/** 「忽略」: the mail's time is not needed (already handled elsewhere, or wrong). */
export async function dismissMailDraft(taskId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.personalTask.updateMany({ where: { id: taskId, userId: user.id }, data: { done: true } });
    revalidate();
    return null;
  });
}

/**
 * Moves a calendar item made from mail onto a 投递's current step — the
 * case where the mail could not be matched (several 投递 at one company).
 */
export async function attachEventToApplication(eventId: string, applicationId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const [event, app] = await Promise.all([
      db.calendarEvent.findFirst({ where: { id: eventId, userId: user.id, stageHistoryId: null }, include: { reminders: true } }),
      db.application.findFirst({
        where: { id: applicationId, userId: user.id },
        select: { id: true, currentStage: true, currentStageDate: true, stageHistory: { select: { id: true, stage: true, enteredAt: true } } },
      }),
    ]);
    if (!event) throw new UserFacingError("这个日程已经不在了，请刷新");
    if (!app) throw new UserFacingError("这条投递已经不在了，请刷新");
    if (event.allDay) throw new UserFacingError("全天事项没有具体时间，请在投递详情里填写");
    if (isTerminalStage(app.currentStage)) throw new UserFacingError("这条投递已经结束，不能再关联面试时间");
    if (!currentStageRow(app, app.stageHistory)) throw new UserFacingError("这条投递没有进度记录");
    await db.$transaction(async (tx) => {
      // The round the title names (moving forward to it), else the current step.
      const target = targetStageFor(app.currentStage, event.title);
      const placed = (target ? await rowForSchedule(tx, app.id, target, { kind: "forward" }) : null)
        ?? await rowForSchedule(tx, app.id, app.currentStage, { kind: "manual" });
      if (!placed) throw new UserFacingError("这条投递没有进度记录");
      const row = { id: placed.rowId };
      const offset = event.reminders[0]?.offsetMinutes;
      await tx.stageHistory.update({
        where: { id: row.id },
        data: {
          nextDeadline: event.startsAt,
          nextDeadlineEnd: event.endsAt,
          nextHasTime: true,
          meetingInfo: event.meetingInfo,
          remindMinutes: offset ?? 30,
          scheduleSource: event.source === "email" ? "email" : null,
        },
      });
      await tx.calendarEvent.delete({ where: { id: event.id } });
      await syncApplicationEvents(tx, app.id);
      const copy = await tx.calendarEvent.findUnique({ where: { stageHistoryId: row.id }, select: { id: true } });
      // The mails behind it now point at the 投递's step; nothing left to undo.
      await tx.personalTask.updateMany({
        where: { userId: user.id, mailEventId: event.id },
        data: { mailEventId: copy?.id ?? null, applicationId: app.id, mailUndo: Prisma.DbNull, mailAppliedSeenAt: new Date() },
      });
    });
    revalidate([app.id]);
    return null;
  });
}

/** 撤销 on an automatically written time. */
export async function undoMailSchedule(taskId: string): Promise<ActionResult<{ kept: boolean }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const result = await db.$transaction((tx) => undoMailScheduleWrite(tx, taskId, user.id));
    if (!result) throw new UserFacingError("这条自动写入已撤销或不存在");
    const task = await db.personalTask.findUnique({ where: { id: taskId }, select: { applicationId: true } });
    revalidate([task?.applicationId]);
    return result;
  });
}

export async function dismissMailSchedules(taskIds: string[]): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = z.array(z.string().min(1)).max(200).safeParse(taskIds);
    if (!parsed.success) throw new UserFacingError("请刷新后重试");
    await db.personalTask.updateMany({ where: { id: { in: parsed.data }, userId: user.id, mailAppliedAt: { not: null }, mailAppliedSeenAt: null }, data: { mailAppliedSeenAt: new Date() } });
    revalidate();
    return null;
  });
}

const BULK_STAGES = ["SCREENING", "ASSESSMENT", "OA", "INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN", "CANCELLED"] as const;

/**
 * One stage for many 投递 at once — typically a batch that never heard back,
 * marked 未通过. Those already at that stage are left alone. Returns the new
 * history rows so 撤销 can take exactly these back.
 */
export async function bulkUpdateStage(applicationIds: string[], stage: string): Promise<ActionResult<{ created: string[]; skipped: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const ids = z.array(z.string().min(1)).min(1).max(500).safeParse(applicationIds);
    const target = z.enum(BULK_STAGES).safeParse(stage);
    if (!ids.success || !target.success) throw new UserFacingError("请先选择投递和要改成的进度");
    const apps = await db.application.findMany({
      where: { id: { in: ids.data }, userId: user.id },
      select: { id: true, currentStage: true, currentStageLabel: true },
    });
    const now = new Date();
    const created: string[] = [];
    await db.$transaction(async (tx) => {
      for (const app of apps) {
        if (app.currentStage === target.data) continue;
        const row = await tx.stageHistory.create({
          data: {
            applicationId: app.id,
            stage: target.data as ApplicationStage,
            ...terminationFields(target.data, app.currentStage, app.currentStageLabel),
            enteredAt: now,
          },
        });
        created.push(row.id);
        await resyncCurrentStage(tx, app.id);
      }
    }, { timeout: 30000 });
    revalidate(apps.map((app) => app.id));
    return { created, skipped: ids.data.length - created.length };
  });
}

/** Takes back the rows one bulkUpdateStage made; each 投递 returns to where it was. */
export async function undoBulkStage(stageHistoryIds: string[]): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const ids = z.array(z.string().min(1)).max(500).safeParse(stageHistoryIds);
    if (!ids.success) throw new UserFacingError("请刷新后重试");
    const rows = await db.stageHistory.findMany({ where: { id: { in: ids.data }, application: { userId: user.id } }, select: { id: true, applicationId: true } });
    await db.$transaction(async (tx) => {
      for (const row of rows) {
        // Never the last row of a 投递 (it cannot be: each had one before).
        if (await tx.stageHistory.count({ where: { applicationId: row.applicationId } }) <= 1) continue;
        await tx.stageHistory.delete({ where: { id: row.id } });
        await resyncCurrentStage(tx, row.applicationId);
      }
    }, { timeout: 30000 });
    revalidate(rows.map((row) => row.applicationId));
    return null;
  });
}

/** Deletes several 投递 (after the list's own 撤销 window has passed). */
export async function bulkDeleteApplications(applicationIds: string[]): Promise<ActionResult<{ deleted: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const ids = z.array(z.string().min(1)).min(1).max(500).safeParse(applicationIds);
    if (!ids.success) throw new UserFacingError("请先选择要删除的投递");
    const deleted = await deleteApplicationsFor(user.id, ids.data);
    revalidatePath("/applications");
    revalidatePath("/pool");
    revalidatePath("/dashboard");
    revalidatePath("/insights");
    revalidatePath("/interviews");
    revalidatePath("/calendar");
    return { deleted };
  });
}
