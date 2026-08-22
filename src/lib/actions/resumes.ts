"use server";

import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { resumeVersionSchema } from "@/lib/validation";
import { z } from "zod";

export async function createResumeVersion(
  input: z.infer<typeof resumeVersionSchema>
) {
  const user = await requireUser();
  const data = resumeVersionSchema.parse(input);

  await db.resumeVersion.create({
    data: {
      userId: user.id,
      name: data.name,
      fileUrl: data.fileUrl,
      targetTrack: data.targetTrack,
    },
  });

  revalidatePath("/resumes");
}

export async function updateResumeVersion(
  id: string,
  input: z.infer<typeof resumeVersionSchema>
) {
  const user = await requireUser();
  const existing = await db.resumeVersion.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) throw new Error("未找到该简历版本");

  const data = resumeVersionSchema.parse(input);
  const replacingFile = data.fileUrl && data.fileUrl !== existing.fileUrl;

  await db.resumeVersion.update({
    where: { id },
    data: {
      name: data.name,
      fileUrl: data.fileUrl ?? existing.fileUrl,
      targetTrack: data.targetTrack,
      // A re-uploaded file invalidates any cached AI review of the old one.
      ...(replacingFile && {
        checkScore: null,
        checkResult: Prisma.JsonNull,
        checkedAt: null,
      }),
    },
  });

  // Best-effort: drop the superseded file so it doesn't leak in Blob storage
  // the same way deleteResumeVersion used to.
  if (replacingFile && existing.fileUrl) {
    try {
      await del(existing.fileUrl);
    } catch {
      // already gone, or transient — nothing left to roll back
    }
  }

  revalidatePath("/resumes");
  revalidatePath("/pool");
}

export async function deleteResumeVersion(id: string) {
  const user = await requireUser();
  const resume = await db.resumeVersion.findFirst({ where: { id, userId: user.id } });
  if (!resume) return;

  await db.resumeVersion.delete({ where: { id } });
  // The PDF was never cleaned up here — every deleted version leaked its file
  // in Blob storage indefinitely. Best-effort: the DB row is already gone.
  if (resume.fileUrl) {
    try {
      await del(resume.fileUrl);
    } catch {
      // already gone, or transient — nothing left to roll back
    }
  }

  revalidatePath("/resumes");
  revalidatePath("/pool");
}

export async function setDefaultResumeVersion(id: string) {
  const user = await requireUser();
  const target = await db.resumeVersion.findFirst({
    where: { id, userId: user.id },
  });
  if (!target) throw new Error("未找到该简历版本");

  await db.$transaction([
    db.resumeVersion.updateMany({
      where: { userId: user.id, isDefault: true },
      data: { isDefault: false },
    }),
    db.resumeVersion.update({
      where: { id },
      data: { isDefault: true },
    }),
  ]);

  revalidatePath("/resumes");
  revalidatePath("/pool");
}
