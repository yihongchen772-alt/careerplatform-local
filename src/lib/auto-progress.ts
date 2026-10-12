import type { ApplicationStage, Prisma } from "@prisma/client";
import { terminationFields } from "@/lib/termination";
import { resyncCurrentStage } from "@/lib/application-stage-history";
import { db } from "@/lib/db";
import { mailTime } from "@/lib/mail-time";

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
  const tasks = await db.personalTask.findMany({
    where: { userId, mailAppliedAt: { not: null }, mailAppliedSeenAt: null, mailUndoneAt: null, ...(applicationId ? { applicationId } : {}) },
    select: { id: true, title: true, note: true, mailUndo: true, mailEventDraft: true, mailAppliedAt: true, application: { select: { id: true, title: true, company: { select: { name: true } } } } },
    orderBy: { mailAppliedAt: "desc" },
    take: 30,
  });
  return tasks.flatMap((task) => {
    const time = mailTime(task.mailEventDraft);
    if (!time) return [];
    const undo = task.mailUndo as { kind?: string; previous?: { nextDeadline?: string | null; nextHasTime?: boolean } } | null;
    const previous = undo?.kind === "stage" && undo.previous?.nextHasTime ? undo.previous.nextDeadline ?? null : null;
    const subject = task.note?.match(/邮件主题：(.+)/)?.[1]?.trim();
    return [{
      id: task.id,
      applicationId: task.application?.id ?? null,
      companyName: task.application?.company.name ?? null,
      title: task.application?.title ?? null,
      what: task.title,
      startsAt: time.startsAt.toISOString(),
      endsAt: time.endsAt?.toISOString() ?? null,
      previousStartsAt: previous,
      meetingInfo: time.meetingInfo,
      onStage: undo?.kind === "stage",
      evidence: subject ? `邮件「${subject.slice(0, 80)}」` : time.evidence || null,
    }];
  });
}
