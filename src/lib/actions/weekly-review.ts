"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { weekStartKey, toDateKey } from "@/lib/dates";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

/** Same threshold daily-digest.ts uses for "worth surfacing even though nothing about it is urgent yet". */
const MATCH_SCORE_THRESHOLD = 75;

export type WeeklyReviewStats = {
  applicationsSubmitted: number;
  stageAdvances: number;
  offers: number;
  rejections: number;
  highMatchNotApplied: number;
  resumeCheckScore: number | null;
};

export type WeeklyReviewResult = {
  weekStart: string;
  weekEnd: string;
  stats: WeeklyReviewStats;
  summary: string;
  highlights: string[];
  concerns: string[];
  suggestions: string[];
};

function weekRange(weekStart: string): { start: Date; end: Date } {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

/** Deterministic counts, computed in code rather than asked of the AI —
 * arithmetic over exact date ranges isn't something to trust a model with
 * when the DB can just answer it. */
async function computeStats(userId: string, weekStart: string): Promise<WeeklyReviewStats> {
  const { start, end } = weekRange(weekStart);

  const [applicationsSubmitted, stageEvents, highMatchNotApplied, defaultResume] = await Promise.all([
    db.application.count({ where: { userId, appliedDate: { gte: start, lt: end } } }),
    db.stageHistory.findMany({
      where: { application: { userId }, enteredAt: { gte: start, lt: end } },
      select: { stage: true },
    }),
    db.positionMatch.count({
      where: {
        userId,
        matchScore: { gte: MATCH_SCORE_THRESHOLD },
        position: { status: { not: "APPLIED" } },
      },
    }),
    db.resumeVersion.findFirst({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      select: { checkScore: true },
    }),
  ]);

  const offerStages = new Set(["OFFER", "ACCEPTED"]);
  const rejectionStages = new Set(["REJECTED", "DECLINED"]);
  let offers = 0;
  let rejections = 0;
  let stageAdvances = 0;
  for (const e of stageEvents) {
    if (e.stage === "APPLIED") continue; // the application's own creation, not a step forward
    stageAdvances++;
    if (offerStages.has(e.stage)) offers++;
    if (rejectionStages.has(e.stage)) rejections++;
  }

  return {
    applicationsSubmitted,
    stageAdvances,
    offers,
    rejections,
    highMatchNotApplied,
    resumeCheckScore: defaultResume?.checkScore ?? null,
  };
}

export async function getWeeklyReview(weekStart?: string): Promise<WeeklyReviewResult | null> {
  const user = await requireUser();
  const key = weekStart ?? weekStartKey();
  const row = await db.weeklyReview.findUnique({
    where: { userId_weekStart: { userId: user.id, weekStart: key } },
  });
  return row ? (row.summary as WeeklyReviewResult) : null;
}

export async function generateWeeklyReview(): Promise<ActionResult<WeeklyReviewResult>> {
  return toActionResult(() => run());
}

const narrativeSchema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
  concerns: z.array(z.string()),
  suggestions: z.array(z.string()),
});

async function run(): Promise<WeeklyReviewResult> {
  const user = await requireUser();
  const config = await getUserAiConfig(user.id);
  if (!config) throw new UserFacingError("先去账号设置配置一个 AI Key 才能用这个功能");

  const weekStart = weekStartKey();
  const { end } = weekRange(weekStart);
  const weekEnd = toDateKey(new Date(end.getTime() - 1));
  const stats = await computeStats(user.id, weekStart);

  // Not week-scoped by design — the previous WeeklyReview row (whatever week
  // it covered) is the only prior data point we have for the resume score,
  // so it's the natural comparison even across an inactive week.
  const previous = await db.weeklyReview.findFirst({
    where: { userId: user.id, weekStart: { lt: weekStart } },
    orderBy: { weekStart: "desc" },
  });
  const previousScore = previous ? (previous.summary as WeeklyReviewResult).stats.resumeCheckScore : null;

  const facts = [
    `本周投递了 ${stats.applicationsSubmitted} 个岗位`,
    `阶段推进 ${stats.stageAdvances} 次（面试/笔试/HR 面等，不含刚投递的初始状态）`,
    `收到 offer ${stats.offers} 个`,
    `收到拒信/流程结束 ${stats.rejections} 次`,
    `候选池里还有 ${stats.highMatchNotApplied} 个高匹配度（≥${MATCH_SCORE_THRESHOLD}分）但还没投的岗位`,
    stats.resumeCheckScore != null
      ? `当前默认简历体检分数：${stats.resumeCheckScore}${previousScore != null ? `（上次记录：${previousScore}）` : ""}`
      : "还没做过简历体检",
  ].join("；");

  const prompt = `你在帮一个正在校招/秋招的候选人做本周求职复盘。这是他本周（${weekStart} 到 ${weekEnd}）的真实数据：

${facts}

请写一份简短的复盘，注意：
- summary：一到两句话概括这周整体节奏怎么样（数据说话，不要空泛地说"要继续加油"这种废话）
- highlights：这周做得好的地方，没有就给空数组，不要硬夸
- concerns：值得注意的问题，比如投递太少、拒信集中、高匹配岗位攒了很多没投等——基于给的数据推断，不要编造没给的信息
- suggestions：下周可以做的具体动作，1-3条，要可执行（比如"候选池里那几个高匹配岗位本周投出去"），不要写"保持积极心态"这类不可执行的话
- 全部用中文，语气像在跟朋友聊进展，不要写成正式报告`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    timeoutMs: 60000,
    schema: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        highlights: { type: "ARRAY", items: { type: "STRING" } },
        concerns: { type: "ARRAY", items: { type: "STRING" } },
        suggestions: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["summary", "highlights", "concerns", "suggestions"],
    },
  });

  const parsed = narrativeSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  const result: WeeklyReviewResult = { weekStart, weekEnd, stats, ...parsed.data };

  await db.weeklyReview.upsert({
    where: { userId_weekStart: { userId: user.id, weekStart } },
    create: { userId: user.id, weekStart, summary: result },
    update: { summary: result },
  });

  revalidatePath("/dashboard");
  return result;
}
