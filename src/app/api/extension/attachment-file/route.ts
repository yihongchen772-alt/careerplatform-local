import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { localPathForStoredUrl, mimeTypeForExtension } from "@/lib/local-storage";
import { friendlyAttachmentUploadName, inferAttachmentRole } from "@/lib/attachment-roles";

export async function GET(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
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
  const bytes = await readFile(filePath).catch(() => null);
  if (!bytes) {
    return NextResponse.json({ error: "附件在本机磁盘上找不到了" }, { status: 404 });
  }
  const ext = path.extname(filePath).toLowerCase() || path.extname(row.name).toLowerCase();
  const role = inferAttachmentRole(row.category, row.name);
  const filename = role ? friendlyAttachmentUploadName(user.name, role, ext) : row.name;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mimeTypeForExtension(ext) || "application/octet-stream",
      "X-File-Name": encodeURIComponent(filename),
    },
  });
}
