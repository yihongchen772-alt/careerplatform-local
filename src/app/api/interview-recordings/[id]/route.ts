import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { loadRecording } from "@/lib/interview-recording";

/** Polled by the recorder page while a recording is being transcribed/reviewed. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const recording = await loadRecording(user.id, id);
  if (!recording) return NextResponse.json({ error: "未找到录音" }, { status: 404 });
  return NextResponse.json(recording);
}
