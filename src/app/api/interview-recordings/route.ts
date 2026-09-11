import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  applicationId: z.string().nullish(),
});

/** Opens a recording; the page then streams WAV chunks to /[id]/chunks. */
export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不对" }, { status: 400 });
  const { title, applicationId } = parsed.data;
  if (applicationId) {
    const app = await db.application.findFirst({ where: { id: applicationId, userId: user.id } });
    if (!app) return NextResponse.json({ error: "未找到该投递记录" }, { status: 404 });
  }
  const row = await db.interviewRecording.create({
    data: { userId: user.id, title, applicationId: applicationId || null, chunks: [] },
  });
  return NextResponse.json({ id: row.id });
}
