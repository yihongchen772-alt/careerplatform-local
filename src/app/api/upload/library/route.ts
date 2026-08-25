import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { ALLOWED_LIBRARY_MIME, saveLocalFile } from "@/lib/local-storage";

/**
 * Separate from /api/upload because the 资料库 accepts Office files and zips
 * that would be meaningless as a resume or JD attachment — widening the
 * shared route would have loosened those too.
 */
const MAX_SIZE = 25 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  await requireUser();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  }
  if (!ALLOWED_LIBRARY_MIME.includes(file.type)) {
    return NextResponse.json(
      { error: "不支持这个格式（可用：PDF、图片、Word/PPT/Excel、zip、txt）" },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "文件不能超过 25MB" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { url } = await saveLocalFile(buffer, file.type);

  return NextResponse.json({ url, name: file.name });
}
