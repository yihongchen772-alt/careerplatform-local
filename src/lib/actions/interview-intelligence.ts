"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const intelligenceSchema = z.object({
  summary: z.string(),
  categories: z.array(
    z.object({
      category: z.string(),
      performance: z.enum(["strong", "ok", "weak"]),
      note: z.string(),
    })
  ),
  nextSessionMix: z.array(
    z.object({
      category: z.string(),
      percent: z.number(),
    })
  ),
});

export type InterviewIntelligence = z.infer<typeof intelligenceSchema>;

/**
 * Merges two data sources that already exist but have never been looked at
 * together: InterviewNoteExtract (what questions actually got asked, by
 * category) and StagePostmortem (where the candidate's own reflections and
 * "next time" notes point at a weakness). Neither alone says "you're weak at
 * X" — a question being asked isn't a performance signal, and a postmortem's
 * improvement note isn't tied to the note-extract's category vocabulary. AI
 * reconciles both to answer two questions no existing feature answers:
 * "which categories am I actually struggling with" and "what should the
 * next mock interview weight toward."
 */
export async function generateInterviewIntelligence(): Promise<
  ActionResult<InterviewIntelligence>
> {
  return toActionResult(() => run());
}

async function run(): Promise<InterviewIntelligence> {
  const user = await requireUser();

  const [noteExtracts, postmortems] = await Promise.all([
    db.interviewNoteExtract.findMany({
      where: { userId: user.id },
      select: { questions: true },
    }),
    db.stagePostmortem.findMany({
      where: { userId: user.id },
      select: { content: true },
    }),
  ]);

  if (noteExtracts.length === 0 && postmortems.length === 0) {
    throw new UserFacingError(
      "还没有面经或复盘记录——先去投递记录的时间线里，给面试笔记跑一次「AI 提取问题清单」或「AI 复盘这场面试」"
    );
  }

  const questionsBlock = noteExtracts
    .flatMap((n) => n.questions as { question: string; category: string }[])
    .map((q) => `[${q.category}] ${q.question}`)
    .join("\n");

  const postmortemBlock = postmortems
    .flatMap((p) => {
      const c = p.content as { reflectionQuestions: string[]; improvements: string[] };
      return [...c.reflectionQuestions, ...c.improvements];
    })
    .join("\n");

  const config = await getUserAiConfig(user.id);
  const prompt = `你在帮一个中国应届生汇总 TA 过往所有面试的表现，判断在各个面试题类别上强弱如何，并给出下一次模拟面试该怎么分配练习比重。

TA 历次面试里被问到的问题（带类别标签）：
${questionsBlock || "（没有记录）"}

TA 过往的面试复盘反思/改进建议（自由文本，不带类别标签，你需要自己判断每条大致对应上面哪个类别）：
${postmortemBlock || "（没有记录）"}

请：
- 把出现过的类别（比如"自我介绍""项目深挖""技术基础""系统设计""场景题""行为面/STAR""反问环节"等，用问题清单里出现过的类别名）汇总，每个类别给：
  - performance：三选一——"strong"（复盘里没有这个类别的负面反思，或者明确提到答得好）、"ok"（问过但没有明显的正面或负面证据）、"weak"（复盘反思/改进建议里有内容对应这个类别，说明这里出过问题）
  - note：一句话说明判断依据，引用具体是哪条反思/建议让你这么判断的；如果只是"问过但没有证据"，如实说"目前没有复盘证据，建议下次多记录"
- nextSessionMix：给下一次模拟面试的类别分配比例，weak 的类别应该占更高比重，几个类别的 percent 加起来大致等于 100（不用精确到个位，大致合理即可），只包含真正值得练习的类别，不用把每个类别都硬塞进去
- summary：一两句话总述目前面试表现的整体情况和最该优先补的地方
- 不要编造问题清单/复盘记录里没有的内容，判断不出来的类别可以标"ok"而不是硬猜"weak"。全部用中文

返回 summary、categories 数组、nextSessionMix 数组。`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    schema: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        categories: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              category: { type: "STRING" },
              performance: { type: "STRING", enum: ["strong", "ok", "weak"] },
              note: { type: "STRING" },
            },
            required: ["category", "performance", "note"],
          },
        },
        nextSessionMix: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              category: { type: "STRING" },
              percent: { type: "NUMBER" },
            },
            required: ["category", "percent"],
          },
        },
      },
      required: ["summary", "categories", "nextSessionMix"],
    },
  });

  const parsed = intelligenceSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.interviewIntelligence.upsert({
    where: { userId: user.id },
    create: { userId: user.id, result: parsed.data },
    update: { result: parsed.data },
  });

  revalidatePath("/interviews");
  return parsed.data;
}
