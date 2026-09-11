import path from "path";
import { z } from "zod";
import type { InterviewRecordingStatus } from "@prisma/client";
import { db } from "@/lib/db";

// Shared shapes + on-disk layout for 面试录音复盘. The route handlers under
// src/app/api/interview-recordings write chunks, src/lib/interview-
// recording-processor.ts turns them into a transcript + review, and the
// /interview-recorder page reads the result. Kept out of the "use server"
// action file so the page-side loader isn't itself a callable action.

export const RECORDING_CHUNK_SECONDS = 300;

export function recordingsRoot(): string {
  const uploads = process.env.LOCAL_UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
  return path.join(uploads, "recordings");
}

export function recordingDir(recordingId: string): string {
  return path.join(recordingsRoot(), recordingId);
}

export const recordingChunkSchema = z.object({
  index: z.number().int().min(0),
  file: z.string(),
  durationSec: z.number().min(0),
  transcript: z.string().nullish(),
});

export const recordingChunksSchema = z.array(recordingChunkSchema);

export const recordingReviewSchema = z.object({
  summary: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      category: z.string(),
      yourAnswer: z.string(),
      assessment: z.string(),
      betterAnswer: z.string(),
    })
  ),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  knowledgeGaps: z.array(z.string()),
});

export type RecordingChunk = z.infer<typeof recordingChunkSchema>;
export type RecordingReview = z.infer<typeof recordingReviewSchema>;

export type InterviewRecordingDTO = {
  id: string;
  title: string;
  status: InterviewRecordingStatus;
  error: string | null;
  transcriber: string | null;
  durationSec: number;
  chunksTotal: number;
  chunksTranscribed: number;
  transcript: string | null;
  review: RecordingReview | null;
  applicationId: string | null;
  applicationLabel: string | null;
  stageHistoryId: string | null;
  startedAt: string;
  endedAt: string | null;
};

export function parseChunks(raw: unknown): RecordingChunk[] {
  const parsed = recordingChunksSchema.safeParse(raw);
  return parsed.success ? parsed.data.sort((a, b) => a.index - b.index) : [];
}

export function parseReview(raw: unknown): RecordingReview | null {
  const parsed = recordingReviewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

type RecordingRow = {
  id: string;
  title: string;
  status: InterviewRecordingStatus;
  error: string | null;
  transcriber: string | null;
  durationSec: number;
  chunks: unknown;
  transcript: string | null;
  review: unknown;
  applicationId: string | null;
  stageHistoryId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  application: { title: string; company: { name: string } } | null;
};

export function toRecordingDTO(row: RecordingRow): InterviewRecordingDTO {
  const chunks = parseChunks(row.chunks);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    error: row.error,
    transcriber: row.transcriber,
    durationSec: row.durationSec,
    chunksTotal: chunks.length,
    chunksTranscribed: chunks.filter((c) => c.transcript != null).length,
    transcript: row.transcript,
    review: parseReview(row.review),
    applicationId: row.applicationId,
    applicationLabel: row.application ? `${row.application.company.name} · ${row.application.title}` : null,
    stageHistoryId: row.stageHistoryId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

export async function loadRecording(userId: string, id: string): Promise<InterviewRecordingDTO | null> {
  const row = await db.interviewRecording.findFirst({
    where: { id, userId },
    include: { application: { include: { company: true } } },
  });
  return row ? toRecordingDTO(row) : null;
}

export async function listRecordings(userId: string): Promise<InterviewRecordingDTO[]> {
  const rows = await db.interviewRecording.findMany({
    where: { userId },
    include: { application: { include: { company: true } } },
    orderBy: { startedAt: "desc" },
  });
  return rows.map(toRecordingDTO);
}
