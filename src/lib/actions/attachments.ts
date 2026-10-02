"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { deleteLocalFileByUrl } from "@/lib/local-storage";

export async function addAttachment(
  input:
    | { applicationId: string; url: string; name: string }
    | { stageHistoryId: string; url: string; name: string }
    | { category: string; url: string; name: string }
) {
  const user = await requireUser();

  // A library file belongs to no application — certificates and portfolios
  // outlive any single application, which is the whole point of having a
  // shelf for them.
  if ("category" in input) {
    const attachment = await db.attachment.create({
      data: {
        userId: user.id,
        url: input.url,
        name: input.name,
        category: input.category,
      },
    });
    revalidatePath("/library");
    return attachment;
  }

  if ("applicationId" in input) {
    const application = await db.application.findFirst({
      where: { id: input.applicationId, userId: user.id },
    });
    if (!application) throw new Error("未找到该投递记录");

    const attachment = await db.attachment.create({
      data: {
        userId: user.id,
        applicationId: input.applicationId,
        url: input.url,
        name: input.name,
      },
    });
    revalidatePath(`/applications/${input.applicationId}`);
    return attachment;
  }

  const stage = await db.stageHistory.findFirst({
    where: { id: input.stageHistoryId, application: { userId: user.id } },
  });
  if (!stage) throw new Error("未找到该状态记录");

  const attachment = await db.attachment.create({
    data: {
      userId: user.id,
      stageHistoryId: input.stageHistoryId,
      url: input.url,
      name: input.name,
    },
  });
  revalidatePath(`/applications/${stage.applicationId}`);
  return attachment;
}

export async function deleteAttachment(id: string) {
  const user = await requireUser();
  const attachment = await db.attachment.findFirst({
    where: { id, userId: user.id },
  });
  if (!attachment) return;

  if (attachment.applicationId) {
    const app = await db.application.findUnique({ where: { id: attachment.applicationId }, select: { submissionPackage: true } });
    const material = app?.submissionPackage;
    if (material && typeof material === "object" && !Array.isArray(material) && material.resumeAttachmentId === id) throw new Error("这是投递材料包中的简历副本，会随投递记录保留");
  }
  await db.attachment.delete({ where: { id } });
  await deleteLocalFileByUrl(attachment.url);

  if (attachment.applicationId) {
    revalidatePath(`/applications/${attachment.applicationId}`);
  }
  revalidatePath("/library");
}
