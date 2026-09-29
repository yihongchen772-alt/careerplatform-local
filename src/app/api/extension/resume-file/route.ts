import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { rejectUnpairedExtension } from "@/lib/extension-auth";
import { localPathForStoredUrl, mimeTypeForExtension } from "@/lib/local-storage";

// The extension can't hand Chrome a local path the way Electron's CDP does, so
// it gets the bytes and attaches them with a DataTransfer in the page.
export async function GET(request: Request) {
  const denied = await rejectUnpairedExtension(request);
  if (denied) return denied;
  const user = await requireUser();
  const id = new URL(request.url).searchParams.get("resumeVersionId");
  if (!id) return NextResponse.json({ error: "没选简历" }, { status: 400 });
  const resume = await db.resumeVersion.findFirst({ where: { id, userId: user.id }, select: { name: true, fileUrl: true } });
  const filePath = resume?.fileUrl ? localPathForStoredUrl(resume.fileUrl) : null;
  if (!resume || !filePath) return NextResponse.json({ error: "选中的简历没有可上传的本地文件" }, { status: 404 });
  const bytes = await readFile(filePath).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "简历文件在本机上找不到了" }, { status: 404 });
  const ext = path.extname(filePath).toLowerCase();
  // Upload under the resume's own display name, not the storage file name.
  const filename = `${resume.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "简历"}${ext}`;
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mimeTypeForExtension(ext) || "application/octet-stream",
      "X-File-Name": encodeURIComponent(filename),
    },
  });
}
