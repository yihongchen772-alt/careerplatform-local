import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { readLocalFile } from "@/lib/local-storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
): Promise<NextResponse> {
  await requireUser();

  const { filename } = await params;
  const file = await readLocalFile(filename);
  if (!file) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.buffer), {
    headers: { "Content-Type": file.mimeType },
  });
}
