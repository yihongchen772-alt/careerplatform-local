"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { fetchFileAsInlinePart } from "@/lib/gemini";
import {
  getFileSearchKey,
  getImageSearchKey,
  generateStructuredWithFile,
} from "@/lib/ai-file-search";
import {
  toActionResult,
  UserFacingError,
  type ActionResult,
} from "@/lib/action-result";
import { resumeCheckSchema, type ResumeCheck } from "@/lib/validation";

export async function checkResume(
  resumeVersionId: string
): Promise<ActionResult<ResumeCheck>> {
  return toActionResult(() => run(resumeVersionId));
}

async function run(resumeVersionId: string): Promise<ResumeCheck> {
  const user = await requireUser();

  const resume = await db.resumeVersion.findFirst({
    where: { id: resumeVersionId, userId: user.id },
  });
  if (!resume) throw new UserFacingError("未找到该简历版本");
  if (!resume.fileUrl) {
    throw new UserFacingError(
      "这个版本还没有上传简历文件，先上传 PDF 或图片再体检"
    );
  }

  // Only known once the file is actually fetched — a .pdf name isn't
  // proof of content, and the mime type is what actually determines which
  // providers can read it (PDF needs FILE_CAPABLE_PROVIDERS; a plain image
  // opens this up to DeepSeek/Kimi/Qwen's vision models too).
  const file = await fetchFileAsInlinePart(resume.fileUrl);
  const isPdf = file.mimeType === "application/pdf";

  const fileKey = isPdf ? await getFileSearchKey(user.id) : await getImageSearchKey(user.id);
  if (!fileKey) {
    throw new UserFacingError(
      isPdf
        ? "简历体检需要读取 PDF 内容，去账号设置 → AI 设置里配置一个 Gemini、Claude 或 OpenAI 的 API Key（DeepSeek/Kimi/Qwen 读不了 PDF）"
        : "简历体检需要读取图片内容，去账号设置 → AI 设置里配置一个 AI Key"
    );
  }

  const prompt = `你是一位帮中国应届生看秋招简历的资深 HR / 技术面试官。请审阅这份简历并给出评估。

评分标准（面向中国互联网/科技公司校招）：
- completeness（完整度 0-10）：是否包含教育背景、项目/实习经历、技能栈、联系方式等必要模块
- quantification（成果量化 0-10）：经历描述是否有具体数字和结果，还是只写"负责xx""参与xx""做了一些优化"这类没有信息量的表述
- clarity（表达清晰度 0-10）：条理、篇幅、用词是否专业，有无冗余或含糊
- score（总分 0-100）：综合判断

要求：
- issues 里必须指出**具体的、这份简历里真实存在的**问题，引用简历里的原话或具体位置，不要写放之四海皆准的套话
- severity：high = 会明显影响通过筛选；medium = 建议改；low = 锦上添花
- suggestions 要可执行，比如"把'做了一些性能优化'改成'接口 P99 从 800ms 降到 120ms'"这种
- strengths 也要具体，如果这份简历确实乏善可陈，就少写几条，不要硬夸
- summary 用一到两句话概括整体水平
- 全部用中文`;

  const raw = await generateStructuredWithFile({
    config: fileKey,
    prompt,
    file,
    // Judgement task over a whole document — needs more headroom than the
    // extraction calls, but still far below Gemini's default.
    thinkingBudget: 1024,
    timeoutMs: 90000,
    schema: {
      type: "OBJECT",
      properties: {
        score: { type: "NUMBER" },
        completeness: { type: "NUMBER" },
        quantification: { type: "NUMBER" },
        clarity: { type: "NUMBER" },
        summary: { type: "STRING" },
        strengths: { type: "ARRAY", items: { type: "STRING" } },
        issues: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              severity: { type: "STRING", enum: ["high", "medium", "low"] },
              text: { type: "STRING" },
            },
            required: ["severity", "text"],
          },
        },
        suggestions: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: [
        "score",
        "completeness",
        "quantification",
        "clarity",
        "summary",
        "strengths",
        "issues",
        "suggestions",
      ],
    },
  });

  const parsed = resumeCheckSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.resumeVersion.update({
    where: { id: resume.id },
    data: {
      checkScore: Math.round(parsed.data.score),
      checkResult: parsed.data,
      checkedAt: new Date(),
    },
  });

  revalidatePath("/resumes");
  return parsed.data;
}
