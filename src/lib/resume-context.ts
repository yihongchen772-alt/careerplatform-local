import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/action-result";
import type { ResumeCheck } from "@/lib/validation";

/**
 * A plain-text stand-in for "what's in this resume", built from the cached
 * AI 体检 result rather than re-reading the PDF. Interview prep/QA generation
 * needs to work with any provider the user has configured (DeepSeek, Kimi,
 * OpenAI...), and only Gemini's inlineData path here can read a file
 * directly — so this reuses the one PDF-reading feature we already have
 * instead of building file/vision support for every provider.
 */
export async function getResumeContext(
  resumeVersionId: string,
  userId: string
): Promise<{ resumeName: string; resumeText: string }> {
  const resume = await db.resumeVersion.findFirst({
    where: { id: resumeVersionId, userId },
  });
  if (!resume) throw new UserFacingError("未找到该简历版本");
  if (!resume.checkResult) {
    throw new UserFacingError(
      "请先在简历版本页对这份简历运行一次「AI 体检」，我们需要先读出简历内容"
    );
  }

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
