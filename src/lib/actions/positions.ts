"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { positionSchema } from "@/lib/validation";
import { computeInterestScore } from "@/lib/scoring";
import { z } from "zod";

export async function createPosition(input: z.infer<typeof positionSchema>) {
  const user = await requireUser();
  const data = positionSchema.parse(input);

  const company = await db.company.upsert({
    where: { name: data.companyName },
    update: {},
    create: { name: data.companyName },
  });

  await db.position.create({
    data: {
      userId: user.id,
      companyId: company.id,
      title: data.title,
      track: data.track,
      department: data.department,
      location: data.location,
      salaryMin: data.salaryMin ?? undefined,
      salaryMax: data.salaryMax ?? undefined,
      jdText: data.jdText,
      jdUrl: data.jdUrl,
      source: data.source,
      deadline: data.deadline ?? undefined,
      status: data.status ?? "EVALUATING",
      scoreBreakdown: data.scoreBreakdown ?? undefined,
      interestScore: computeInterestScore(data.scoreBreakdown),
    },
  });

  revalidatePath("/pool");
  revalidatePath("/dashboard");
}

export async function updatePosition(
  id: string,
  input: Partial<z.infer<typeof positionSchema>>
) {
  const user = await requireUser();
  const existing = await db.position.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw new Error("未找到该岗位");

  const data = positionSchema.partial().parse(input);

  let companyId = existing.companyId;
  if (data.companyName) {
    const company = await db.company.upsert({
      where: { name: data.companyName },
      update: {},
      create: { name: data.companyName },
    });
    companyId = company.id;
  }

  const mergedBreakdown = data.scoreBreakdown
    ? { ...(existing.scoreBreakdown as object), ...data.scoreBreakdown }
    : undefined;

  await db.position.update({
    where: { id },
    data: {
      companyId,
      title: data.title,
      track: data.track,
      department: data.department,
      location: data.location,
      salaryMin: data.salaryMin ?? undefined,
      salaryMax: data.salaryMax ?? undefined,
      jdText: data.jdText,
      jdUrl: data.jdUrl,
      source: data.source,
      deadline: data.deadline ?? undefined,
      status: data.status,
      scoreBreakdown: mergedBreakdown,
      interestScore: mergedBreakdown
        ? computeInterestScore(mergedBreakdown)
        : undefined,
    },
  });

  revalidatePath("/pool");
  revalidatePath("/dashboard");
}

export async function deletePosition(id: string) {
  const user = await requireUser();
  await db.position.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/pool");
}

export async function markPositionApplied(
  id: string,
  input: { appliedDate: Date; referrer?: string; resumeVersionId?: string }
) {
  const user = await requireUser();
  const position = await db.position.findFirst({
    where: { id, userId: user.id },
    include: { company: true },
  });
  if (!position) throw new Error("未找到该岗位");

  await db.$transaction(async (tx) => {
    const application = await tx.application.create({
      data: {
        userId: user.id,
        positionId: position.id,
        companyId: position.companyId,
        title: position.title,
        appliedDate: input.appliedDate,
        referrer: input.referrer,
        source: position.source,
        resumeVersionId: input.resumeVersionId,
        currentStage: "APPLIED",
        salaryMin: position.salaryMin,
        salaryMax: position.salaryMax,
      },
    });

    await tx.stageHistory.create({
      data: {
        applicationId: application.id,
        stage: "APPLIED",
      },
    });

    await tx.position.update({
      where: { id: position.id },
      data: { status: "APPLIED" },
    });
  });

  revalidatePath("/pool");
  revalidatePath("/applications");
  revalidatePath("/dashboard");
}

export async function markPositionsApplied(
  ids: string[],
  input: { appliedDate: Date; referrer?: string; resumeVersionId?: string }
) {
  const user = await requireUser();
  const positions = await db.position.findMany({
    where: { id: { in: ids }, userId: user.id },
  });

  await db.$transaction(async (tx) => {
    for (const position of positions) {
      const application = await tx.application.create({
        data: {
          userId: user.id,
          positionId: position.id,
          companyId: position.companyId,
          title: position.title,
          appliedDate: input.appliedDate,
          referrer: input.referrer,
          source: position.source,
          resumeVersionId: input.resumeVersionId,
          currentStage: "APPLIED",
          salaryMin: position.salaryMin,
          salaryMax: position.salaryMax,
        },
      });

      await tx.stageHistory.create({
        data: {
          applicationId: application.id,
          stage: "APPLIED",
        },
      });

      await tx.position.update({
        where: { id: position.id },
        data: { status: "APPLIED" },
      });
    }
  });

  revalidatePath("/pool");
  revalidatePath("/applications");
  revalidatePath("/dashboard");
}
