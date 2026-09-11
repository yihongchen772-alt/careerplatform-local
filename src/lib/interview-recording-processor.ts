import path from "path";
import { readFile } from "fs/promises";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getUserAiConfig, getUserAiKey, callTextAi } from "@/lib/ai-providers";
import { generateStructuredWithFile } from "@/lib/ai-file-search";
import { localWhisperReady, transcribeWithLocalWhisper } from "@/lib/render-bridge-client";
import { STAGE_LABELS } from "@/lib/stage-labels";
import {
  parseChunks,
  recordingDir,
  recordingReviewSchema,
  type RecordingChunk,
  type RecordingReview,
} from "@/lib/interview-recording";

// Turns a finished recording's WAV chunks into a transcript and an AI
// review. Runs detached from the HTTP request that triggered it (the
// /finish route fires it and returns), writing progress into the row so the
// page can poll. Transcription goes to whisper.cpp in the desktop app when a
// model is installed — the audio never leaves the machine — and otherwise
// to Gemini, chunk by chunk; the review step is plain text and uses the
// user's default provider like every other AI feature.

const inFlight = new Set<string>();

export function startProcessing(recordingId: string) {
  if (inFlight.has(recordingId)) return;
  inFlight.add(recordingId);
  runPipeline(recordingId)
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : "处理失败";
      await db.interviewRecording
        .update({ where: { id: recordingId }, data: { status: "FAILED", error: message } })
        .catch(() => {});
    })
    .finally(() => inFlight.delete(recordingId));
}

async function runPipeline(recordingId: string) {
  const row = await db.interviewRecording.findUnique({ where: { id: recordingId } });
  if (!row) return;
  const chunks = parseChunks(row.chunks);
  if (chunks.length === 0) throw new Error("没有录到任何音频");

  const useLocal = await localWhisperReady();
  await db.interviewRecording.update({
    where: { id: recordingId },
    data: { status: "TRANSCRIBING", error: null, transcriber: useLocal ? "whisper-local" : "gemini" },
  });

  for (const chunk of chunks) {
    if (chunk.transcript != null) continue; // resumed after a failure — keep what's done
    const file = path.join(recordingDir(recordingId), chunk.file);
    const text = useLocal ? await transcribeLocal(file) : await transcribeGemini(row.userId, file);
    chunk.transcript = text;
    await db.interviewRecording.update({
      where: { id: recordingId },
      data: { chunks: chunks as unknown as Prisma.InputJsonValue },
    });
  }

  const transcript = mergeTranscript(chunks);
  if (transcript.trim().length < 20) {
    throw new Error("转写出来几乎没有内容——检查录音时麦克风有没有选对、面试官的声音有没有被录进去");
  }
  await db.interviewRecording.update({
    where: { id: recordingId },
    data: { status: "REVIEWING", transcript },
  });

  const review = await reviewTranscript(row.userId, row.applicationId, transcript, row.durationSec);
  await db.interviewRecording.update({
    where: { id: recordingId },
    data: { status: "DONE", review: review as Prisma.InputJsonValue },
  });
}

async function transcribeLocal(file: string): Promise<string> {
  const { segments } = await transcribeWithLocalWhisper(file);
  // whisper.cpp emits a few well-known hallucinations on silence
  // ("请不吝点赞 订阅 转发 打赏支持明镜与点点栏目" is the infamous one for
  // Chinese) — drop segments that are just that boilerplate.
  return segments
    .map((s) => s.text.trim())
    .filter((t) => t && !/明镜|点点栏目|字幕by|Amara\.org/i.test(t))
    .join("\n");
}

async function transcribeGemini(userId: string, file: string): Promise<string> {
  const config = await getUserAiKey(userId, "gemini");
  if (!config) {
    throw new Error("没有下载本地转写模型，又没有配置 Gemini 的 Key——去「账号设置」二选一");
  }
  const base64 = (await readFile(file)).toString("base64");
  const raw = await generateStructuredWithFile({
    config,
    prompt: `这是一段真实求职面试的录音片段（可能是整场面试的其中 5 分钟），说话的人有面试官和候选人。请逐字转写成中文文本，按说话轮次分行，能分辨的话在每行开头标「面试官：」或「候选人：」，分不清就不标。只写听到的内容，不要总结、不要补全、不要评价。听不清的地方写「（听不清）」。`,
    file: { mimeType: "audio/wav", data: base64 },
    schema: {
      type: "OBJECT",
      properties: { transcript: { type: "STRING" } },
      required: ["transcript"],
    },
    thinkingBudget: 512,
    timeoutMs: 180000,
  });
  const parsed = z.object({ transcript: z.string() }).safeParse(raw);
  if (!parsed.success) throw new Error("Gemini 转写结果格式异常");
  return parsed.data.transcript.trim();
}

function mergeTranscript(chunks: RecordingChunk[]): string {
  let offset = 0;
  return chunks
    .map((c) => {
      const m = Math.floor(offset / 60);
      const s = Math.floor(offset % 60);
      offset += c.durationSec;
      return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} 起]\n${(c.transcript ?? "").trim()}`;
    })
    .join("\n\n");
}

async function reviewTranscript(
  userId: string,
  applicationId: string | null,
  transcript: string,
  durationSec: number
): Promise<RecordingReview> {
  const config = await getUserAiConfig(userId);
  const application = applicationId
    ? await db.application.findFirst({
        where: { id: applicationId, userId },
        include: { company: true, position: true },
      })
    : null;
  const target = application
    ? [
        `公司：${application.company.name}`,
        `岗位：${application.title}`,
        `当前阶段：${STAGE_LABELS[application.currentStage]}`,
        application.position?.jdText ? `JD 摘要：${application.position.jdText.slice(0, 1500)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "（没有关联具体投递）";

  const prompt = `下面是一名中国应届生一场真实面试的录音转写（约 ${Math.round(durationSec / 60)} 分钟，语音转写可能有错字、没有标点、说话人标注可能缺失，请自行结合上下文判断谁在说话）。请帮候选人做面试复盘。

面试对象：
${target}

转写全文：
${transcript.slice(0, 60000)}

请输出：
- summary：两三句话概括这场面试——问了哪几类问题、整体表现如何、最关键的转折点是什么。
- questions：面试官实际问过的每一个问题（按出现顺序），每个包含：
  - question：问题本身（用面试官的原意整理成一句清楚的话）
  - category：自我介绍 / 项目深挖 / 技术基础 / 系统设计 / 场景题 / 行为面 / 反问环节 / 其他
  - yourAnswer：候选人实际怎么答的，两三句概括，引用原话中的关键表述
  - assessment：这个回答好在哪、差在哪，具体到点，不说空话；如果候选人明显答不上来或被追问到卡住，直说
  - betterAnswer：如果重来，更好的回答思路（3-5 句，第一人称，用候选人自己已经说出的真实信息来组织，不编造经历）
- strengths：整场表现里真正做得好的 2-4 点，引用具体片段
- improvements：最需要改的 2-4 点，可执行
- knowledgeGaps：这场面试暴露出来的知识/技能盲区，每条一个具体知识点（比如"Redis 持久化 RDB vs AOF 的区别"），用来当复习清单；没有就空数组

转写里如果几乎全是候选人一个人在说（面试官声音没录进来），仍然尽量从候选人的回答反推问题。全部用中文。`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 2048,
    timeoutMs: 180000,
    schema: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        questions: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              question: { type: "STRING" },
              category: { type: "STRING" },
              yourAnswer: { type: "STRING" },
              assessment: { type: "STRING" },
              betterAnswer: { type: "STRING" },
            },
            required: ["question", "category", "yourAnswer", "assessment", "betterAnswer"],
          },
        },
        strengths: { type: "ARRAY", items: { type: "STRING" } },
        improvements: { type: "ARRAY", items: { type: "STRING" } },
        knowledgeGaps: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["summary", "questions", "strengths", "improvements", "knowledgeGaps"],
    },
  });
  const parsed = recordingReviewSchema.safeParse(raw);
  if (!parsed.success) throw new Error("AI 复盘结果格式异常，可以点「重新生成复盘」再试");
  return parsed.data;
}
