"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getResumeContext } from "@/lib/resume-context";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const skillGapSchema = z.object({
  summary: z.string(),
  skills: z.array(
    z.object({
      skill: z.string(),
      mentionCount: z.number(),
      onResume: z.boolean(),
      note: z.string(),
    })
  ),
});

export type SkillGapAnalysis = z.infer<typeof skillGapSchema>;

// Each JD only needs to contribute its keyword signal, not read in full —
// capping per-JD length keeps a watchlist of 20 postings from blowing the
// prompt budget the way sending each one's full 6000-char text would.
const MAX_POSITIONS = 20;
const JD_EXCERPT_LENGTH = 1500;

/**
 * Aggregates every tracked position's JD instead of comparing one at a time
 * the way resume-match.ts does — a single JD's "you're missing X" is one
 * opinion, but "9 of the 15 postings you're watching mention Kubernetes and
 * your resume doesn't" is a much stronger, harder-to-ignore signal about
 * what's actually worth learning next.
 */
export async function generateSkillGapAnalysis(
  resumeVersionId: string
): Promise<ActionResult<SkillGapAnalysis>> {
  return toActionResult(() => run(resumeVersionId));
}

async function run(resumeVersionId: string): Promise<SkillGapAnalysis> {
  const user = await requireUser();

  const positions = await db.position.findMany({
    where: { userId: user.id, jdText: { not: null } },
    select: { title: true, jdText: true, company: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_POSITIONS,
  });
  if (positions.length === 0) {
    throw new UserFacingError(
      "候选池里还没有带 JD 正文的岗位——添加岗位时粘贴 JD 文字，攒够几个就能跑这个分析了"
    );
  }

  const { resumeText } = await getResumeContext(resumeVersionId, user.id);

  const jdList = positions
    .map(
      (p, i) =>
        `【${i + 1}】${p.company.name} · ${p.title}\n${p.jdText!.slice(0, JD_EXCERPT_LENGTH)}`
    )
    .join("\n\n");

  const prompt = `你在帮一个中国应届生分析：TA 正在关注的这一批岗位的 JD 里，反复出现哪些技能/技术关键词，简历里有没有覆盖到。

下面是 TA 追踪的 ${positions.length} 个岗位的 JD：
${jdList}

候选人当前简历内容：
${resumeText}

请：
- 从这些 JD 里提炼出被反复提到的技能/技术关键词（不是每个 JD 单独出现一次的冷门词，要挑跨多个 JD 反复出现、说明是这个方向普遍看重的），做归一化处理（比如"K8s"和"Kubernetes"算同一个）
- 每个关键词给出：skill（关键词本身）、mentionCount（在这 ${positions.length} 个 JD 里出现的次数，如实统计，不要夸大）、onResume（简历里是否已经体现，true/false）、note（一句话，如果 onResume 为 false 就建议怎么去补，如果为 true 可以说简历里哪里已经覆盖了）
- 按 mentionCount 从高到低排序，挑最多 15 个最有代表性的，不用把所有零散提到一次的词都列出来
- summary：一两句话总结这批岗位整体看重什么方向，简历目前最大的缺口是什么
- 全部用中文，不要编造简历里没有的内容

返回 summary 和 skills 数组。`;

  const config = await getUserAiConfig(user.id);
  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    schema: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        skills: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              skill: { type: "STRING" },
              mentionCount: { type: "NUMBER" },
              onResume: { type: "BOOLEAN" },
              note: { type: "STRING" },
            },
            required: ["skill", "mentionCount", "onResume", "note"],
          },
        },
      },
      required: ["summary", "skills"],
    },
  });

  const parsed = skillGapSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.skillGapAnalysis.upsert({
    where: { resumeVersionId },
    create: { userId: user.id, resumeVersionId, result: parsed.data },
    update: { result: parsed.data },
  });

  revalidatePath("/insights");
  return parsed.data;
}
