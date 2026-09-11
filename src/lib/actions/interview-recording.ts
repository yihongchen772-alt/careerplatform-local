"use server";

import { rm } from "fs/promises";
import { revalidatePath } from "next/cache";
import { Prisma, type ApplicationStage } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { parseReview, recordingDir, type RecordingReview } from "@/lib/interview-recording";
import { startProcessing } from "@/lib/interview-recording-processor";

const INTERVIEW_STAGES: ApplicationStage[] = ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"];

/** Re-runs transcription (keeping chunks already done) and the review. */
export async function retryRecordingProcessing(recordingId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = await db.interviewRecording.findFirst({ where: { id: recordingId, userId: user.id } });
    if (!row) throw new UserFacingError("未找到录音");
    if (row.status === "RECORDING") throw new UserFacingError("这段录音还没结束");
    await db.interviewRecording.update({
      where: { id: recordingId },
      data: { status: "TRANSCRIBING", error: null, review: Prisma.DbNull },
    });
    startProcessing(recordingId);
    revalidatePath("/interview-recorder");
    return null;
  });
}

export async function deleteRecording(recordingId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const deleted = await db.interviewRecording.deleteMany({ where: { id: recordingId, userId: user.id } });
    if (deleted.count === 0) throw new UserFacingError("未找到录音");
    // The audio is the sensitive part; the row going away must take it with it.
    await rm(recordingDir(recordingId), { recursive: true, force: true });
    revalidatePath("/interview-recorder");
    return null;
  });
}

function reviewToNote(title: string, review: RecordingReview): string {
  const lines: string[] = [`【面试录音复盘 · ${title}】`, review.summary, ""];
  if (review.questions.length > 0) {
    lines.push("问到的问题：");
    review.questions.forEach((q, i) => {
      lines.push(`${i + 1}. ${q.question}（${q.category}）`);
      lines.push(`   我的回答：${q.yourAnswer}`);
      lines.push(`   点评：${q.assessment}`);
    });
    lines.push("");
  }
  if (review.strengths.length) lines.push("做得好的：", ...review.strengths.map((s) => `- ${s}`), "");
  if (review.improvements.length) lines.push("要改的：", ...review.improvements.map((s) => `- ${s}`), "");
  if (review.knowledgeGaps.length) lines.push("要补的知识点：", ...review.knowledgeGaps.map((s) => `- ${s}`));
  return lines.join("\n").trim();
}

/**
 * Files the review into 面经库: writes it as the note on the application's
 * latest interview-stage entry (creating one at the current stage if the
 * application has no interview stage yet) and seeds the entry's extracted
 * question list, so the 面经库 card shows the questions immediately without
 * a second AI pass. Idempotent per recording — refiling overwrites the same
 * StageHistory row rather than adding another.
 */
export async function fileRecordingToLibrary(recordingId: string): Promise<ActionResult<{ stageHistoryId: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = await db.interviewRecording.findFirst({
      where: { id: recordingId, userId: user.id },
      include: { application: true },
    });
    if (!row) throw new UserFacingError("未找到录音");
    if (!row.applicationId || !row.application) throw new UserFacingError("这段录音没有关联投递记录，没法存进面经库");
    const review = parseReview(row.review);
    if (!review) throw new UserFacingError("复盘还没生成好");

    const note = reviewToNote(row.title, review);
    let stageHistoryId = row.stageHistoryId;

    if (stageHistoryId) {
      const existing = await db.stageHistory.findFirst({ where: { id: stageHistoryId, applicationId: row.applicationId } });
      if (!existing) stageHistoryId = null;
    }
    if (!stageHistoryId) {
      const latestInterview = await db.stageHistory.findFirst({
        where: { applicationId: row.applicationId, stage: { in: INTERVIEW_STAGES } },
        orderBy: { enteredAt: "desc" },
      });
      if (latestInterview && !latestInterview.note) {
        stageHistoryId = latestInterview.id;
      } else {
        // Either no interview stage yet, or its note is the user's own words
        // — don't clobber those; add a sibling entry at the same stage.
        const stage = latestInterview?.stage ?? (INTERVIEW_STAGES.includes(row.application.currentStage) ? row.application.currentStage : "INTERVIEW_1");
        const created = await db.stageHistory.create({
          data: { applicationId: row.applicationId, stage, enteredAt: row.startedAt, interviewFormat: "录音复盘" },
        });
        stageHistoryId = created.id;
      }
    }

    await db.$transaction([
      db.stageHistory.update({ where: { id: stageHistoryId }, data: { note } }),
      db.interviewNoteExtract.upsert({
        where: { stageHistoryId },
        create: {
          userId: user.id,
          stageHistoryId,
          questions: review.questions.map((q) => ({ question: q.question, category: q.category })),
        },
        update: { questions: review.questions.map((q) => ({ question: q.question, category: q.category })) },
      }),
      db.interviewRecording.update({ where: { id: recordingId }, data: { stageHistoryId } }),
    ]);

    revalidatePath("/interviews");
    revalidatePath("/interview-recorder");
    revalidatePath(`/applications/${row.applicationId}`);
    return { stageHistoryId };
  });
}
