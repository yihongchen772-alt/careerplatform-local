"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { applicationSchema, offerUpdateSchema, stageUpdateSchema } from "@/lib/validation";
import { z } from "zod";

export async function createApplication(
  input: z.infer<typeof applicationSchema>
) {
  const user = await requireUser();
  const data = applicationSchema.parse(input);

  const company = await db.company.upsert({
    where: { name: data.companyName },
    update: {},
    create: { name: data.companyName },
  });

  await db.$transaction(async (tx) => {
    const application = await tx.application.create({
      data: {
        userId: user.id,
        positionId: data.positionId ?? undefined,
        companyId: company.id,
        title: data.title,
        appliedDate: data.appliedDate,
        referrer: data.referrer,
        source: data.source,
        resumeVersionId: data.resumeVersionId ?? undefined,
        currentStage: "APPLIED",
      },
    });

    await tx.stageHistory.create({
      data: {
        applicationId: application.id,
        stage: "APPLIED",
        enteredAt: data.appliedDate,
      },
    });
  });

  revalidatePath("/applications");
  revalidatePath("/dashboard");
}

export async function addStageUpdate(
  applicationId: string,
  input: z.infer<typeof stageUpdateSchema>
) {
  const user = await requireUser();
  const application = await db.application.findFirst({
    where: { id: applicationId, userId: user.id },
  });
  if (!application) throw new Error("未找到该投递记录");

  const data = stageUpdateSchema.parse(input);

  const stageHistoryId = await db.$transaction(async (tx) => {
    const created = await tx.stageHistory.create({
      data: {
        applicationId,
        stage: data.stage,
        note: data.note,
        interviewFormat: data.interviewFormat,
        interviewer: data.interviewer,
        nextDeadline: data.nextDeadline ?? undefined,
      },
    });

    await tx.application.update({
      where: { id: applicationId },
      data: {
        currentStage: data.stage,
        currentStageDate: new Date(),
      },
    });

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
    },
  });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/compare");
}
