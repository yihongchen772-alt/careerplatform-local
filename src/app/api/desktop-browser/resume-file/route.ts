import { access } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { localPathForStoredUrl } from "@/lib/local-storage";
import { resumeUploadName } from "@/lib/resume-used";

/** Trusted localhost hand-off to Electron's main process. The returned path
 * is never injected into the visited page; CDP receives it directly. */
export async function GET(request: Request) {
  const user = await requireUser();
  const id = new URL(request.url).searchParams.get("resumeVersionId");
  if (!id) return NextResponse.json({ error: "没选简历" }, { status: 400 });

  const resume = await db.resumeVersion.findFirst({
    where: { id, userId: user.id },
    select: { name: true, fileUrl: true },
  });
  const filePath = resume?.fileUrl ? localPathForStoredUrl(resume.fileUrl) : null;
  if (!resume || !filePath) {
    return NextResponse.json({ error: "选中的简历没有可上传的本地文件" }, { status: 404 });
  }
  try {
    await access(filePath);
  } catch {
    return NextResponse.json({ error: "简历文件在本机上找不到了" }, { status: 404 });
  }
  // What HR sees as the attachment: 「姓名-简历.pdf」, not the stored hex name.
  const uploadName = resumeUploadName(user.name, path.extname(filePath));
  return NextResponse.json({ path: filePath, filename: path.basename(filePath), name: resume.name, uploadName });
}
