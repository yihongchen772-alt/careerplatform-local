import { db } from "@/lib/db";
import { UserFacingError } from "@/lib/action-result";
import { assistantActionSchema, type AssistantAction } from "@/lib/assistant-shared";
import { createChat } from "@/lib/agent/llm";
import { runAgent } from "@/lib/agent/run";
import { AGENT_TOOLS, describeToolCall, executeTool } from "@/lib/agent/tools";
import { buildAgentSystemPrompt } from "@/lib/agent/prompt";
import { getAgentConfig } from "@/lib/agent/config";

// 小欧 speaking first: a short brief each morning and a review each Sunday,
// written when the app is opened (never in the background, so nothing runs
// on the user's Key unseen), at most once per day / week.

export type BriefKind = "daily" | "weekly";
export type BriefView = { kind: BriefKind; period: string; content: string; actions: AssistantAction[]; createdAt: string };

function ymd(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today for the daily brief; the review's Sunday (from 17:00 that day) for the weekly one. */
export function briefPeriod(kind: BriefKind, now = new Date()): string {
  if (kind === "daily") return ymd(now);
  const sunday = new Date(now);
  const back = now.getDay() === 0 ? (now.getHours() >= 17 ? 0 : 7) : now.getDay();
  sunday.setDate(now.getDate() - back);
  return ymd(sunday);
}

/** Whether a brief is owed now: mornings from 5:00; a review until Thursday, not after. */
export function briefDue(kind: BriefKind, existing: boolean, now = new Date()): boolean {
  if (existing) return false;
  if (kind === "daily") return now.getHours() >= 5;
  const sunday = new Date(`${briefPeriod("weekly", now)}T17:00:00`);
  return now.getTime() - sunday.getTime() < 4 * 86_400_000;
}

const PROMPTS: Record<BriefKind, string> = {
  daily: "（这是小欧每天早上主动写的「今日简报」，用户还没提问。）先看快照，必要时用工具看临近面试/笔试的投递详情，然后写简报：\n1. 今天最要紧的 1-3 件事，每件一句话：做什么、为什么、去哪里做（可以用 Markdown 链接，如 [宝洁 · 一面](/applications/ID)）\n2. 接下来 3 天的面试 / 笔试 / 截止\n3. 一句提醒或鼓励\n需要改记录的（比如已经过了截止的笔试标记完成、给临近的面试加准备待办）用 propose_actions 生成按钮。简报正文必须完整写在你最后的回答里（不要只回「已完成」「按钮在下面」）。不寒暄，不编造，200 字以内。",
  weekly: "（这是小欧每周日主动写的「周复盘」，用户还没提问。）用工具查这一周的投递和进展，然后：\n1. 用 update_plan 更新下周的求职计划（重点、按优先级的待推进事项、风险）\n2. 回答写复盘：这周新投了几个、有哪些进展（进面 / 被拒 / Offer）、哪些该跟进；下周最重要的三件事\n需要改记录的用 propose_actions 生成按钮。复盘正文必须完整写在你最后的回答里。不寒暄，不编造，300 字以内。",
};

const running = new Map<string, Promise<BriefView | null>>();

export function toBriefView(row: { kind: string; period: string; content: string; actions: unknown; createdAt: Date }): BriefView {
  const actions = Array.isArray(row.actions) ? row.actions.map((item) => assistantActionSchema.safeParse(item)).filter((item) => item.success).map((item) => item.data) : [];
  return { kind: row.kind as BriefKind, period: row.period, content: row.content, actions, createdAt: row.createdAt.toISOString() };
}

/** Writes this period's brief (once; concurrent callers share one run). Null without an AI Key. */
export function writeBrief(userId: string, kind: BriefKind, now = new Date()): Promise<BriefView | null> {
  const period = briefPeriod(kind, now);
  const key = `${userId}:${kind}:${period}`;
  const pending = running.get(key);
  if (pending) return pending;
  const job = (async () => {
    const config = await getAgentConfig(userId);
    if (!config) return null;
    const proposed: AssistantAction[] = [];
    const result = await runAgent({
      chat: createChat(),
      request: { config, system: await buildAgentSystemPrompt(userId), messages: [{ role: "user", text: PROMPTS[kind] }], tools: AGENT_TOOLS },
      execute: (call) => executeTool(userId, call, proposed),
      describe: describeToolCall,
      emit: () => {},
      maxRounds: 8,
    });
    if (!result.reply.trim()) throw new UserFacingError("小欧这次没写出简报，稍后再试");
    const row = await db.agentBrief.upsert({
      where: { userId_kind_period: { userId, kind, period } },
      create: { userId, kind, period, content: result.reply, actions: proposed },
      update: { content: result.reply, actions: proposed, createdAt: new Date() },
    });
    return toBriefView(row);
  })().finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

/** What the 总览 card shows: today's brief, this week's review, and which one is owed. */
export async function loadBriefState(userId: string, now = new Date()) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { agentDailyBrief: true, agentWeeklyReview: true, defaultAiProvider: true, agentAiProvider: true } });
  // Without any AI Key there is nobody to write it: not owed, not an error on every visit.
  const canWrite = !!(user?.defaultAiProvider || user?.agentAiProvider);
  const [daily, weekly] = await Promise.all([
    db.agentBrief.findUnique({ where: { userId_kind_period: { userId, kind: "daily", period: briefPeriod("daily", now) } } }),
    db.agentBrief.findUnique({ where: { userId_kind_period: { userId, kind: "weekly", period: briefPeriod("weekly", now) } } }),
  ]);
  return {
    daily: daily ? toBriefView(daily) : null,
    weekly: weekly ? toBriefView(weekly) : null,
    dailyDue: canWrite && !!user?.agentDailyBrief && briefDue("daily", !!daily, now),
    weeklyDue: canWrite && !!user?.agentWeeklyReview && briefDue("weekly", !!weekly, now),
  };
}
