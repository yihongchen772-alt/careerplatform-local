import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/action-result";
import { extractResumeContent } from "@/lib/resume-extract";
import type { ResumeCheck } from "@/lib/validation";

/**
 * A plain-text stand-in for "what's in this resume" — used by every feature
 * that needs real resume content but must work with whatever AI provider
 * the user has configured (DeepSeek, Kimi, OpenAI...), not just a
 * file-capable one. Prefers ResumeVersion.extractedText (src/lib/
 * resume-extract.ts — a genuine content extraction, normally already
 * populated in the background on upload for 网申自动填充's benefit) and
 * extracts on demand here if it's missing, rather than the old fallback of
 * building this from the cached AI 体检 review: that's a quality critique
 * (score/strengths/issues), not the resume's actual content, and forcing
 * the user to run 体检 first was only ever a workaround for not having real
 * extracted text available yet — never actually about needing a review.
 */
export async function getResumeContext(
  resumeVersionId: string,
  userId: string
): Promise<{ resumeName: string; resumeText: string }> {
  const resume = await db.resumeVersion.findFirst({
    where: { id: resumeVersionId, userId },
  });
  if (!resume) throw new UserFacingError("未找到该简历版本");

  let extractedText = resume.extractedText;
  if (!extractedText) {
    await extractResumeContent(userId, resumeVersionId);
    const refreshed = await db.resumeVersion.findUnique({
      where: { id: resumeVersionId },
      select: { extractedText: true },
    });
    extractedText = refreshed?.extractedText ?? null;
  }

  if (extractedText) {
    const text = [
      resume.targetTrack ? `目标方向：${resume.targetTrack}` : null,
      `简历内容：\n${extractedText}`,
    ]
      .filter(Boolean)
      .join("\n");
    return { resumeName: resume.name, resumeText: text };
  }

  // Extraction needs a file-capable provider (Gemini/Claude/OpenAI/Qwen) —
  // if none is configured, or it failed, fall back to whatever the AI 体检
  // review already captured rather than a hard failure straight away.
  if (resume.checkResult) {
    const check = resume.checkResult as ResumeCheck;
    const text = [
      resume.targetTrack ? `目标方向：${resume.targetTrack}` : null,
      `简历总体评价：${check.summary}`,
      check.strengths.length ? `亮点：${check.strengths.join("；")}` : null,
      check.issues.length
        ? `不足：${check.issues.map((i) => i.text).join("；")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
    return { resumeName: resume.name, resumeText: text };
  }

  throw new UserFacingError(
    "读取简历内容失败，请检查账号设置里是否配置了 Gemini/Claude/OpenAI/Qwen 之一（PDF 需要这几家才能读）"
  );
}
