import { db } from "@/lib/db";
import { fetchFileAsInlinePart } from "@/lib/gemini";
import {
  getFileSearchKey,
  getImageSearchKey,
  generateStructuredWithFile,
} from "@/lib/ai-file-search";

/**
 * Reads the resume file once and caches a plain-text digest of its actual
 * content (education/experience/projects/skills) on ResumeVersion.
 * extractedText — every place that needs real resume content (currently:
 * 网申自动填充 in src/app/api/desktop-browser/answer-questions/route.ts) was
 * re-reading and re-sending the whole file to an AI on every single use.
 *
 * Intentionally NOT a "use server" action: it takes a raw userId with no
 * auth check of its own, since every current caller already has an
 * authenticated userId in hand (a "use server" export would make this
 * directly invocable from a client component with an arbitrary userId).
 *
 * Fire-and-forget by design — every caller does `void extractResumeContent(...)`
 * rather than awaiting it, and every failure here is swallowed rather than
 * thrown: a missing/failed extraction just means the next caller falls back
 * to reading the raw file directly, so this is a pure optimization, never a
 * hard requirement.
 */
export async function extractResumeContent(
  userId: string,
  resumeVersionId: string
): Promise<void> {
  try {
    const resume = await db.resumeVersion.findFirst({
      where: { id: resumeVersionId, userId },
    });
    if (!resume?.fileUrl) return;

    const file = await fetchFileAsInlinePart(resume.fileUrl);
    const isPdf = file.mimeType === "application/pdf";
    const fileKey = isPdf ? await getFileSearchKey(userId) : await getImageSearchKey(userId);
    if (!fileKey) return;

    const prompt = `把这份简历的实际内容整理成一段结构清晰的纯文本，供以后 AI 回答网申问题时当作简历原文参考——不是摘要、不是点评，是把简历里写的东西原样转写成好读的文本。

包含：教育背景（学校/专业/学历/时间）、实习/工作经历（公司/岗位/时间/内容）、项目经历（名称/角色/内容/成果）、技能/技术栈、其他信息（证书/竞赛/语言等，如果简历里有的话）。

只整理简历里确实写了的内容，不要编造、不要评价好坏、不要打分。全部用中文，用换行分段，不用 markdown 标题符号。`;

    const raw = await generateStructuredWithFile({
      config: fileKey,
      prompt,
      file,
      thinkingBudget: 512,
      timeoutMs: 90000,
      schema: {
        type: "OBJECT",
        properties: { text: { type: "STRING" } },
        required: ["text"],
      },
    });

    const text = (raw as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || !text.trim()) return;

    await db.resumeVersion.update({
      where: { id: resumeVersionId },
      data: { extractedText: text, extractedAt: new Date() },
    });
  } catch {
    // Best-effort cache warm — never let this surface as a user-facing
    // error. Whoever needed the content falls back to the raw file.
  }
}
