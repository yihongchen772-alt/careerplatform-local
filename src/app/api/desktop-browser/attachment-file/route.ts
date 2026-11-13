import { stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { localPathForStoredUrl, mimeTypeForExtension } from "@/lib/local-storage";
import { friendlyAttachmentUploadName, inferAttachmentRole } from "@/lib/attachment-roles";

export async function GET(request: Request) {
  const user = await requireUser();
  const id = new URL(request.url).searchParams.get("attachmentId");
  if (!id) return NextResponse.json({ error: "没指定附件" }, { status: 400 });
  const row = await db.attachment.findFirst({
    where: { id, userId: user.id },
    select: { name: true, url: true, category: true },
  });
  const filePath = row?.url ? localPathForStoredUrl(row.url) : null;
  if (!row || !filePath) {
    return NextResponse.json({ error: "找不到这个附件文件" }, { status: 404 });
  }
  const exists = await stat(filePath).catch(() => null);
  if (!exists?.isFile()) {
    return NextResponse.json({ error: "附件在本机磁盘上找不到了，请重新上传" }, { status: 404 });
  }
  const ext = path.extname(filePath).toLowerCase() || path.extname(row.name).toLowerCase();
  const role = inferAttachmentRole(row.category, row.name);
  const uploadName = role
    ? friendlyAttachmentUploadName(user.name, role, ext)
    : row.name;
  return NextResponse.json({
    path: filePath,
    filename: path.basename(filePath),
    name: row.name,
    uploadName,
    role,
    mimeType: mimeTypeForExtension(ext) || "application/octet-stream",
  });
}
