import { NextResponse } from "next/server";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseChunks, recordingDir } from "@/lib/interview-recording";

// A 5-minute 16 kHz mono 16-bit WAV is ~9.6 MB; leave headroom for the
// header and a slightly-over-length final chunk.
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

/**
 * One WAV chunk of an in-progress recording. Multipart rather than a Server
 * Action for the same reason the resume upload is — base64-through-an-action
 * costs a third more bytes and trips React's payload guards at this size.
 * Written to disk *and* recorded in the row immediately, so a crash after
 * this returns loses nothing already uploaded.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const row = await db.interviewRecording.findFirst({ where: { id, userId: user.id } });
  if (!row) return NextResponse.json({ error: "未找到录音" }, { status: 404 });
  if (row.status !== "RECORDING") return NextResponse.json({ error: "这段录音已经结束了" }, { status: 409 });

  const form = await request.formData();
  const audio = form.get("audio");
  const index = Number(form.get("index"));
  if (!(audio instanceof File) || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }
  if (audio.size > MAX_CHUNK_BYTES) return NextResponse.json({ error: "音频片段太大" }, { status: 413 });

  const dir = recordingDir(id);
  await mkdir(dir, { recursive: true });
  const file = `chunk-${String(index).padStart(3, "0")}.wav`;
  const bytes = Buffer.from(await audio.arrayBuffer());
  await writeFile(path.join(dir, file), bytes);
  // Exact, from the file itself: 16 kHz mono 16-bit PCM is 32,000 bytes/s
  // after the 44-byte header. The client's wall-clock estimate isn't needed.
  const durationSec = Math.max(0, (bytes.length - 44) / 32000);

  const chunks = parseChunks(row.chunks).filter((c) => c.index !== index);
  chunks.push({ index, file, durationSec });
  chunks.sort((a, b) => a.index - b.index);
  await db.interviewRecording.update({
    where: { id },
    data: {
      chunks: chunks as unknown as Prisma.InputJsonValue,
      durationSec: Math.round(chunks.reduce((n, c) => n + c.durationSec, 0)),
    },
  });
  return NextResponse.json({ ok: true, chunks: chunks.length });
}
