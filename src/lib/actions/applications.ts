"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import {
  applicationCoreUpdateSchema,
  applicationSchema,
  offerUpdateSchema,
  stageUpdateSchema,
} from "@/lib/validation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { resolveCompanyId } from "@/lib/company-resolver";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { latestStageEntry } from "@/lib/application-stage-history";

export async function createApplication(
  input: z.infer<typeof applicationSchema>
) {
  const user = await requireUser();
  const data = applicationSchema.parse(input);

  const companyId = await resolveCompanyId(data.companyName, { aiUserId: user.id });

  await db.$transaction(async (tx) => {
    const portals = await tx.applicationPortal.findMany({ where: { companyId }, select: { id: true }, take: 2 });
    const application = await tx.application.create({
      data: {
        userId: user.id,
        positionId: data.positionId ?? undefined,
        companyId,
        portalId: portals.length === 1 ? portals[0].id : null,
        title: data.title,
        appliedDate: data.appliedDate,
        referrer: data.referrer,
        source: data.source,
        resumeVersionId: data.resumeVersionId ?? undefined,
        currentStage: "APPLIED",
        currentStageDate: data.appliedDate,
      },
    });

    await tx.stageHistory.create({
      data: {
        applicationId: application.id,
        stage: "APPLIED",
        enteredAt: data.appliedDate,
      },
    });
    if (application.portalId) {
      // The page can be text-identical to the last check while this new
      // application has never been matched against it.
      await tx.applicationPortal.update({ where: { id: application.portalId }, data: { contentHash: null } });
    }
  });

  revalidatePath("/applications");
  revalidatePath("/dashboard");
}

export async function addStageUpdate(
  applicationId: string,
  input: z.infer<typeof stageUpdateSchema> & { enteredAt?: Date | string }
) {
  const user = await requireUser();
  const application = await db.application.findFirst({
    where: { id: applicationId, userId: user.id },
  });
  if (!application) throw new Error("未找到该投递记录");

  const data = stageUpdateSchema.parse(input);
  // Defaults to now, same as before this accepted an override — the board's
  // drag-to-a-column interaction is the one caller that actually sets this,
  // for backdating/correcting when a stage change really happened.
  const enteredAt = input.enteredAt ? new Date(input.enteredAt) : new Date();
  if (Number.isNaN(enteredAt.getTime())) throw new Error("时间格式不对");

  const stageHistoryId = await db.$transaction(async (tx) => {
    const created = await tx.stageHistory.create({
      data: {
        applicationId,
        stage: data.stage,
        stageLabel: data.stageLabel || null,
        note: data.note,
        interviewFormat: data.interviewFormat,
        interviewer: data.interviewer,
        nextDeadline: data.nextDeadline ?? undefined,
        nextDeadlineEnd: data.nextDeadlineEnd ?? undefined,
        enteredAt,
      },
    });

    await resyncCurrentStage(tx, applicationId);

    return created.id;
  });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/applications");
  revalidatePath("/dashboard");

  return { stageHistoryId };
}

export async function deleteApplication(id: string) {
  const user = await requireUser();

  const application = await db.application.findFirst({
    where: { id, userId: user.id },
    select: { id: true, positionId: true },
  });
  if (!application) return;

  await db.$transaction(async (tx) => {
    // Stage history and attachments cascade from the schema.
    await tx.application.delete({ where: { id: application.id } });

    // Without this the source position stays marked APPLIED with nothing behind
    // it, and the pool hides 标记已投 in that state — leaving it unrecoverable.
    if (application.positionId) {
      await tx.position.updateMany({
        where: { id: application.positionId, userId: user.id },
        data: { status: "EVALUATING" },
      });
    }
  });

  revalidatePath("/applications");
  revalidatePath("/pool");
  revalidatePath("/dashboard");
  revalidatePath("/insights");
  revalidatePath("/interviews");
}

export async function updateApplication(
  applicationId: string,
  input: z.infer<typeof applicationCoreUpdateSchema>
) {
  const user = await requireUser();
  const application = await db.application.findFirst({
    where: { id: applicationId, userId: user.id },
  });
  if (!application) throw new Error("未找到该投递记录");

  const data = applicationCoreUpdateSchema.parse(input);

  await db.application.update({
    where: { id: applicationId },
    data: {
      appliedDate: data.appliedDate,
      referrer: data.referrer || null,
      source: data.source || null,
      resumeVersionId: data.resumeVersionId || null,
    },
  });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/applications");
  revalidatePath("/dashboard");
}

export async function updateApplicationOffer(
  applicationId: string,
  input: z.infer<typeof offerUpdateSchema>
) {
  const user = await requireUser();
  const application = await db.application.findFirst({
    where: { id: applicationId, userId: user.id },
  });
  if (!application) throw new Error("未找到该投递记录");

  const data = offerUpdateSchema.parse(input);

  await db.application.update({
    where: { id: applicationId },
    data: {
      salaryMin: data.salaryMin ?? undefined,
      salaryMax: data.salaryMax ?? undefined,
      offerNote: data.offerNote,
      offerAnnualTotal: data.offerAnnualTotal ?? null,
      commuteMinutes: data.commuteMinutes ?? null,
      overtimeNote: data.overtimeNote || null,
      growthNote: data.growthNote || null,
    },
  });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/compare");
}

/**
 * Recomputes the application's current stage from whatever history remains.
 * Called after an edit or a delete: currentStage is a denormalised copy of
 * "the newest history row", and leaving it pointing at a row that was just
 * changed or removed is how the record silently starts lying.
 */
async function resyncCurrentStage(
  tx: Prisma.TransactionClient,
  applicationId: string
): Promise<void> {
  const application = await tx.application.findUnique({
    where: { id: applicationId },
    select: { appliedDate: true, currentStage: true, currentStageLabel: true, currentStageDate: true },
  });
  if (!application) return;
  const history = await tx.stageHistory.findMany({
    where: { applicationId },
  });
  // The first APPLIED event contains a date-only value (UTC midnight), which
  // can sort after a real event on that same local day. Treat it as the
  // baseline, then choose the latest dated event among everything else.
  const latest = latestStageEntry(history, application.appliedDate);
  if (!latest) return;
  const stageChanged = application.currentStage !== latest.stage || application.currentStageLabel !== latest.stageLabel;
  if (!stageChanged && application.currentStageDate.getTime() === latest.enteredAt.getTime()) return;
  await tx.application.update({
    where: { id: applicationId },
    data: {
      currentStage: latest.stage,
      currentStageLabel: latest.stageLabel,
      currentStageDate: latest.enteredAt,
      ...(stageChanged ? { portalSuggestedStage: null, portalSuggestedAt: null } : {}),
    },
  });
}

/**
 * Corrects one timeline entry. Misclicks are routine — the board's
 * one-click advance makes them more so — and without this the only fix was
 * to leave the wrong stage sitting in the record forever.
 */
export async function updateStageHistory(
  id: string,
  input: z.infer<typeof stageUpdateSchema> & { enteredAt?: Date | string }
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const existing = await db.stageHistory.findFirst({
      where: { id, application: { userId: user.id } },
    });
    if (!existing) throw new UserFacingError("未找到这条状态记录");

    const data = stageUpdateSchema.parse(input);
    const enteredAt = input.enteredAt ? new Date(input.enteredAt) : null;
    if (enteredAt && Number.isNaN(enteredAt.getTime())) {
      throw new UserFacingError("时间格式不对");
    }

    await db.$transaction(async (tx) => {
      await tx.stageHistory.update({
        where: { id },
        data: {
          stage: data.stage,
          stageLabel: data.stageLabel || null,
          note: data.note || null,
          interviewFormat: data.interviewFormat || null,
          interviewer: data.interviewer || null,
          nextDeadline: data.nextDeadline ?? null,
          nextDeadlineEnd: data.nextDeadlineEnd ?? null,
          ...(enteredAt ? { enteredAt } : {}),
        },
      });
      await resyncCurrentStage(tx, existing.applicationId);
    });

    revalidatePath(`/applications/${existing.applicationId}`);
    revalidatePath("/applications");
    revalidatePath("/dashboard");
    return null;
  });
}

export async function deleteStageHistory(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const existing = await db.stageHistory.findFirst({
      where: { id, application: { userId: user.id } },
    });
    if (!existing) throw new UserFacingError("未找到这条状态记录");

    const remaining = await db.stageHistory.count({
      where: { applicationId: existing.applicationId },
    });
    if (remaining <= 1) {
      throw new UserFacingError(
        "这是最后一条状态记录，删了这条投递就没有任何阶段了——要删的话请直接删除整条投递"
      );
    }

    await db.$transaction(async (tx) => {
      await tx.stageHistory.delete({ where: { id } });
      await resyncCurrentStage(tx, existing.applicationId);
    });

    revalidatePath(`/applications/${existing.applicationId}`);
    revalidatePath("/applications");
    revalidatePath("/dashboard");
    return null;
  });
}
