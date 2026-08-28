"use server";

import { z } from "zod";
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

const matchSchema = z.object({
  matchScore: z.number().min(0).max(100),
  matchedPoints: z.array(z.string()),
  gaps: z.array(z.string()),
  suggestion: z.string(),
});

export type ResumeMatch = z.infer<typeof matchSchema> & {
  resumeVersionId: string;
  resumeName: string;
};

export type MatchResult = {
  /** True when the position has no JD body, so scoring is coarse. */
  coarse: boolean;
  matches: ResumeMatch[];
};

/** Each comparison is a paid call over a whole PDF; cap the fan-out. */
const MAX_RESUMES = 5;

export async function matchResumesToPosition(
  positionId: string
): Promise<ActionResult<MatchResult>> {
  return toActionResult(() => run(positionId));
}

async function run(positionId: string): Promise<MatchResult> {
  const user = await requireUser();

  const position = await db.position.findFirst({
    where: { id: positionId, userId: user.id },
    include: { company: true },
  });
  if (!position) throw new UserFacingError("未找到该岗位");

  const resumes = await db.resumeVersion.findMany({
    where: { userId: user.id, fileUrl: { not: null } },
    orderBy: { createdAt: "desc" },
    take: MAX_RESUMES,
  });
  if (resumes.length === 0) {
    throw new UserFacingError("还没有上传过简历文件，先去简历版本页上传一份");
  }

  const coarse = !position.jdText;

  const jobDescription = [
    `公司：${position.company.name}`,
    `岗位：${position.title}`,
    position.track ? `方向：${position.track}` : null,
    position.location ? `地点：${position.location}` : null,
    position.salaryMin || position.salaryMax
      ? `薪资：${position.salaryMin ?? "?"}-${position.salaryMax ?? "?"}K`
      : null,
    position.jdText ? `\nJD 正文：\n${position.jdText.slice(0, 8000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Resumes in one match run can be a mix of PDFs and images — each needs
  // its own capability check (PDF is the strict subset, see
  // FILE_CAPABLE_PROVIDERS vs IMAGE_CAPABLE_PROVIDERS), fetched only after
  // downloading the file since the mime type is what actually decides it,
  // not the filename. Promise.allSettled rather than Promise.all: one resume
  // failing (unsupported file type for the user's configured providers, a
  // transient AI error) shouldn't blank out results for every other resume
  // that succeeded.
  const settled = await Promise.allSettled(
    resumes.map(async (resume) => {
      const file = await fetchFileAsInlinePart(resume.fileUrl!);
      const isPdf = file.mimeType === "application/pdf";
      const fileKey = isPdf ? await getFileSearchKey(user.id) : await getImageSearchKey(user.id);
      if (!fileKey) {
        throw new UserFacingError(
          isPdf
            ? `「${resume.name}」是 PDF，需要 Gemini/Claude/OpenAI/Qwen 其中一个的 Key（DeepSeek/Kimi 读不了 PDF）`
            : `「${resume.name}」需要配置一个 AI Key 才能读图片`
        );
      }

      const prompt = `你在帮一个中国应届生判断：投这个岗位时，这份简历合不合适。

目标岗位：
${jobDescription}
${coarse ? "\n注意：这个岗位没有提供 JD 正文，只能依据岗位名称和方向判断，请在 suggestion 里说明结论较粗略。" : ""}

请阅读附件里的简历，然后：
- matchScore（0-100）：这份简历投这个岗位的匹配程度
- matchedPoints：简历里**确实写到的**、能对上岗位要求的点，引用简历里的具体内容，不要泛泛而谈
- gaps：岗位需要但简历里没体现的能力/经历，要具体
- suggestion：一句话建议，比如该不该用这份投、投之前该补什么

不要编造简历里没有的内容。全部用中文。`;

      const raw = await generateStructuredWithFile({
        config: fileKey,
        prompt,
        file,
        thinkingBudget: 1024,
        timeoutMs: 90000,
        schema: {
          type: "OBJECT",
          properties: {
            matchScore: { type: "NUMBER" },
            matchedPoints: { type: "ARRAY", items: { type: "STRING" } },
            gaps: { type: "ARRAY", items: { type: "STRING" } },
            suggestion: { type: "STRING" },
          },
          required: ["matchScore", "matchedPoints", "gaps", "suggestion"],
        },
      });

      const parsed = matchSchema.safeParse(raw);
      if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

      return {
        ...parsed.data,
        resumeVersionId: resume.id,
        resumeName: resume.name,
      };
    })
  );

  const matches = settled
    .filter((r): r is PromiseFulfilledResult<ResumeMatch> => r.status === "fulfilled")
    .map((r) => r.value);

  if (matches.length === 0) {
    const firstError = settled.find(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    )?.reason;
    throw firstError instanceof Error
      ? new UserFacingError(firstError.message)
      : new UserFacingError("没有一份简历能完成匹配，检查一下 AI 设置");
  }

  matches.sort((a, b) => b.matchScore - a.matchScore);
  return { coarse, matches };
}
