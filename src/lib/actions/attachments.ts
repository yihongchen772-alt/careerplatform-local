"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { deleteLocalFileByUrl } from "@/lib/local-storage";

export async function addAttachment(
  input:
    | { applicationId: string; url: string; name: string }
    | { stageHistoryId: string; url: string; name: string }
) {
  const user = await requireUser();

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

  await db.attachment.delete({ where: { id } });
  await deleteLocalFileByUrl(attachment.url);

  if (attachment.applicationId) {
    revalidatePath(`/applications/${attachment.applicationId}`);
  }
}
