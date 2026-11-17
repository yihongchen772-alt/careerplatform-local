import type { ApplicationStage, Prisma } from "@prisma/client";
import { terminationFields } from "@/lib/termination";
import { resyncCurrentStage } from "@/lib/application-stage-history";
import { db } from "@/lib/db";
import { mailDraftMeta, mailTime, mailTimeOver } from "@/lib/mail-time";
import { isTerminalStage, overlapping, targetStageFor, type Slot } from "@/lib/interview-schedule";
import { RECRUIT_EVENT } from "@/lib/mail-time-extract";

export type AutoProgressSource = "portal" | "email";

/**
 * Writes one recognised stage into the timeline. It goes through the same
 * history row + resync path as a manual update, so undoing it is just
 * deleting the row; autoSource marks it for the 自动更新 banner.
 */
export async function writeAutoStage(
  tx: Prisma.TransactionClient,
  input: {
    applicationId: string;
    stage: ApplicationStage;
    stageLabel: string | null;
    enteredAt: Date;
    note: string;
    source: AutoProgressSource;
    evidence: string;
    previousStage: ApplicationStage;
    previousLabel: string | null;
  }
): Promise<string> {
  const created = await tx.stageHistory.create({
    data: {
      applicationId: input.applicationId,
      stage: input.stage,
      ...terminationFields(input.stage, input.previousStage, input.previousLabel),
      stageLabel: input.stageLabel?.slice(0, 100) || null,
      enteredAt: input.enteredAt,
      note: input.note,
      autoSource: input.source,
      autoEvidence: input.evidence.slice(0, 300),
    },
  });
  await resyncCurrentStage(tx, input.applicationId);
  return created.id;
}

/** Unreviewed automatic updates for the 自动更新 banner, newest first. */
export async function loadAutoProgressItems(userId: string, applicationId?: string) {
  const rows = await db.stageHistory.findMany({
    where: { autoSource: { not: null }, autoSeenAt: null, application: { userId, ...(applicationId ? { id: applicationId } : {}) } },
    select: { id: true, applicationId: true, stage: true, stageLabel: true, autoSource: true, autoEvidence: true, enteredAt: true, application: { select: { title: true, company: { select: { name: true } } } } },
    orderBy: { enteredAt: "desc" },
    take: 30,
  });
  return rows.map((row) => ({
    id: row.id,
    applicationId: row.applicationId,
    companyName: row.application.company.name,
    title: row.application.title,
    stage: row.stage,
    stageLabel: row.stageLabel,
    source: row.autoSource ?? "portal",
    evidence: row.autoEvidence,
    enteredAt: row.enteredAt.toISOString(),
  }));
}

/**
 * Interview / 笔试 times inbox recognition wrote by itself and the user has
 * not looked at yet — shown in the same 自动更新 banner, with 撤销.
 */
export async function loadAutoScheduleItems(userId: string, applicationId?: string) {
  const [tasks, calendarEvents] = await Promise.all([
    db.personalTask.findMany({
      where: { userId, mailAppliedAt: { not: null }, mailAppliedSeenAt: null, mailUndoneAt: null, ...(applicationId ? { applicationId } : {}) },
      select: { id: true, title: true, note: true, mailEventId: true, mailUndo: true, mailEventDraft: true, mailAppliedAt: true, application: { select: { id: true, title: true, company: { select: { name: true } } } } },
      orderBy: { mailAppliedAt: "desc" },
      take: 30,
    }),
    db.calendarEvent.findMany({
      where: { userId, allDay: false, startsAt: { gte: new Date(Date.now() - 12 * 3_600_000) } },
      select: { id: true, title: true, startsAt: true, endsAt: true },
      take: 200,
    }),
  ]);
  const slots: Slot[] = calendarEvents.map((e) => ({
    key: e.id,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    label: e.title,
  }));
  return tasks.flatMap((task) => {
    const time = mailTime(task.mailEventDraft);
    if (!time) return [];
    const undo = task.mailUndo as { kind?: string; previous?: { nextDeadline?: string | null; nextHasTime?: boolean } } | null;
    const previous = undo?.kind === "stage" && undo.previous?.nextHasTime ? undo.previous.nextDeadline ?? null : null;
    const subject = task.note?.match(/邮件主题：(.+)/)?.[1]?.trim();
    const meta = mailDraftMeta(task.mailEventDraft, task.note);
    const clash = time.hasTime ? overlapping(slots, time.startsAt, time.endsAt, task.mailEventId)[0]?.label ?? null : null;
    return [{
      id: task.id,
      applicationId: task.application?.id ?? null,
      companyName: task.application?.company.name ?? null,
      title: task.application?.title ?? null,
      what: task.title,
      startsAt: time.startsAt.toISOString(),
      endsAt: time.endsAt?.toISOString() ?? null,
      hasTime: time.hasTime,
      previousStartsAt: previous,
      meetingInfo: time.meetingInfo ?? meta.meetingInfo,
      accessCode: meta.accessCode || null,
      actionRequired: meta.actionRequired || null,
      clashWith: clash,
      onStage: undo?.kind === "stage",
      evidence: subject ? `邮件「${subject.slice(0, 80)}」` : time.evidence || null,
    }];
  });
}

export type MailConflictItem = {
  id: string;
  applicationId: string;
  companyName: string;
  title: string;
  what: string;
  mailStartsAt: string;
  mailEndsAt: string | null;
  mailHasTime: boolean;
  existingStartsAt: string;
  existingHasTime: boolean;
  meetingInfo: string | null;
  evidence: string | null;
};

/**
 * Finds mail schedules that arrived cleanly but hit a conflict against a manual
 * time the user had already placed on the application's target step.
 */
export async function loadMailScheduleConflicts(userId: string, applicationId?: string): Promise<MailConflictItem[]> {
  const now = Date.now();
  const tasks = await db.personalTask.findMany({
    where: {
      userId,
      done: false,
      mailEventId: null,
      mailAppliedAt: null,
      mailUndoneAt: null,
      sourceMailKey: { not: null },
      applicationId: applicationId ? applicationId : { not: null },
    },
    select: {
      id: true,
      title: true,
      note: true,
      mailEventDraft: true,
      application: {
        select: {
          id: true,
          title: true,
          currentStage: true,
          company: { select: { name: true } },
          stageHistory: {
            select: { stage: true, nextDeadline: true, nextHasTime: true, scheduleSource: true, completedAt: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const conflicts: MailConflictItem[] = [];
  for (const task of tasks) {
    const app = task.application;
    if (!app || isTerminalStage(app.currentStage)) continue;
    const time = mailTime(task.mailEventDraft);
    if (!time || time.booking || RECRUIT_EVENT.test(`${task.title} ${time.title}`) || mailTimeOver(time) <= now) continue;
    const target = targetStageFor(app.currentStage, `${time.title} ${task.title} ${time.evidence}`);
    const row = target ? app.stageHistory.find((r) => r.stage === target) : undefined;
    if (!row || row.completedAt || !row.nextDeadline || row.scheduleSource === "email") continue;
    if (!row.nextHasTime && time.hasTime) continue;
    if (row.nextHasTime === time.hasTime && row.nextDeadline.getTime() === time.startsAt.getTime()) continue;
    const subject = task.note?.match(/邮件主题：(.+)/)?.[1]?.trim();
    const meta = mailDraftMeta(task.mailEventDraft, task.note);
    conflicts.push({
      id: task.id,
      applicationId: app.id,
      companyName: app.company.name,
      title: app.title,
      what: task.title,
      mailStartsAt: time.startsAt.toISOString(),
      mailEndsAt: time.endsAt?.toISOString() ?? null,
      mailHasTime: time.hasTime,
      existingStartsAt: row.nextDeadline.toISOString(),
      existingHasTime: row.nextHasTime,
      meetingInfo: time.meetingInfo ?? meta.meetingInfo,
      evidence: subject ? `邮件「${subject.slice(0, 80)}」` : time.evidence || null,
    });
  }
  return conflicts;
}
