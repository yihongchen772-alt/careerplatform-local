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

const matchRecommendations = [
  "强烈建议投",
  "可以投",
  "海投备用",
  "不建议浪费时间",
] as const;

const breakdownRowSchema = z.object({
  requirement: z.string(),
  evidence: z.string(),
  verdict: z.enum(["match", "partial", "missing"]),
});

const matchSchema = z.object({
  matchScore: z.number().min(0).max(100),
  recommendation: z.enum(matchRecommendations),
  breakdown: z.array(breakdownRowSchema),
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
${coarse ? "\n注意：这个岗位没有提供 JD 正文，只能依据岗位名称和方向判断，breakdown 可以给得粗一些，suggestion 里要说明结论较粗略。" : ""}

请阅读附件里的简历，然后：
- breakdown：从 JD 里提炼出 5-8 条关键要求（技能/经验/学历等），每条给：
  - requirement：这条要求本身
  - evidence：简历里**确实写到的**、能证明这条要求的具体内容；如果简历里完全没有对应内容，写"简历里没有体现"
  - verdict：match（明确满足）/ partial（部分满足或有一定相关性）/ missing（没有体现）
- matchScore（0-100）：综合上面的拆解给一个匹配度
- recommendation：从这四个里选一个——"强烈建议投"/"可以投"/"海投备用"/"不建议浪费时间"，不要只给分数不给结论
- suggestion：一句话建议，比如投之前该补什么、这份简历的哪个部分该调整

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
            recommendation: { type: "STRING", enum: [...matchRecommendations] },
            breakdown: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  requirement: { type: "STRING" },
                  evidence: { type: "STRING" },
                  verdict: { type: "STRING", enum: ["match", "partial", "missing"] },
                },
                required: ["requirement", "evidence", "verdict"],
              },
            },
            suggestion: { type: "STRING" },
          },
          required: ["matchScore", "recommendation", "breakdown", "suggestion"],
        },
      });

      const parsed = matchSchema.safeParse(raw);
      if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

      // Cached per (position, resume) pair — lets the daily digest read
      // match quality later without paying for another AI call, and saves
      // re-running this exact comparison if nothing's changed.
      await db.positionMatch.upsert({
        where: { positionId_resumeVersionId: { positionId, resumeVersionId: resume.id } },
        create: {
          userId: user.id,
          positionId,
          resumeVersionId: resume.id,
          matchScore: Math.round(parsed.data.matchScore),
          recommendation: parsed.data.recommendation,
          result: { breakdown: parsed.data.breakdown, suggestion: parsed.data.suggestion },
        },
        update: {
          matchScore: Math.round(parsed.data.matchScore),
          recommendation: parsed.data.recommendation,
          result: { breakdown: parsed.data.breakdown, suggestion: parsed.data.suggestion },
        },
      });

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
