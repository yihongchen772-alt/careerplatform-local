"use server";

import { readFile } from "fs/promises";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { deleteLocalFileByUrl, localPathForStoredUrl, saveLocalFile } from "@/lib/local-storage";
import { photoFromPdf } from "@/lib/resume-photo";

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

export async function extractResumePhotoToLibrary(
  resumeVersionId?: string
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const user = await requireUser();
  const resumes = await db.resumeVersion.findMany({
    where: { userId: user.id, fileUrl: { not: null } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, fileUrl: true },
  });
  const chosen = resumeVersionId
    ? resumes.find((r) => r.id === resumeVersionId)
    : resumes[0];
  if (!chosen?.fileUrl) {
    return { ok: false, message: "还没有上传 PDF 简历，先去简历管理上传一份，或直接上传证件照图片" };
  }
  const filePath = localPathForStoredUrl(chosen.fileUrl);
  if (!filePath || !filePath.toLowerCase().endsWith(".pdf")) {
    return { ok: false, message: `当前简历「${chosen.name}」不是 PDF 文件，可直接点上方上传证件照` };
  }
  const pdf = await readFile(filePath).catch(() => null);
  if (!pdf) {
    return { ok: false, message: "在本机上找不到这份简历文件" };
  }
  const dataUrl = photoFromPdf(pdf);
  if (!dataUrl) {
    return { ok: false, message: `「${chosen.name}」里没有提取到标准竖版证件照（可能用了 PNG 或无照片），可直接上传 jpg/png 证件照` };
  }
  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  const { url } = await saveLocalFile(buffer, "image/jpeg");
  const cleanUser = user.name?.trim() && user.name.trim() !== "我" ? `${user.name.trim()}-` : "";
  const fileName = `${cleanUser}证件照（来自${chosen.name}）.jpg`;
  await db.attachment.create({
    data: {
      userId: user.id,
      url,
      name: fileName,
      category: "证件照",
    },
  });
  revalidatePath("/library");
  return { ok: true, name: fileName };
}
