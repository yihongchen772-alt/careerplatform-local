import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { startProcessing } from "@/lib/interview-recording-processor";

/** Recording stopped: close the row and kick off transcription in the background. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const row = await db.interviewRecording.findFirst({ where: { id, userId: user.id } });
  if (!row) return NextResponse.json({ error: "未找到录音" }, { status: 404 });
  if (row.status === "RECORDING") {
    await db.interviewRecording.update({
      where: { id },
      data: { status: "TRANSCRIBING", endedAt: new Date() },
    });
  }
  startProcessing(id);
  return NextResponse.json({ ok: true });
}
