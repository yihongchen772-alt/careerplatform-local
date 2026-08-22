import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { ALLOWED_UPLOAD_MIME, saveLocalFile } from "@/lib/local-storage";

const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  await requireUser();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  }
  if (!ALLOWED_UPLOAD_MIME.includes(file.type)) {
    return NextResponse.json({ error: "只支持 PDF 或图片格式" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { url } = await saveLocalFile(buffer, file.type);

  return NextResponse.json({ url, name: file.name });
}
