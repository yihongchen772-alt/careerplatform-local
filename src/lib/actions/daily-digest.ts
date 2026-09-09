"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { buildTodos } from "@/lib/todos";
import { todayKey } from "@/lib/dates";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

export type DigestItem = {
  label: string;
  reason: string;
  href: string;
  /** Rough estimate in minutes — used to chain suggested time blocks from
   * "now" client-side, not to have the AI reason about wall-clock time
   * (models are unreliable at exactly that kind of arithmetic — see the
   * relative-date lookup table in assistant.ts for the same lesson learned
   * about not trusting a model with date/time arithmetic it can get wrong). */
  estimatedMinutes: number;
  /** Toggled by the user as they work through today's list — see
   * toggleDigestItem below. Always false on a fresh generation. */
  done: boolean;
};

/** High-confidence, not-yet-applied matches worth surfacing even when
 * nothing about them is urgent yet — buildTodos only knows about deadlines
 * and stale records, not match quality. */
const MATCH_SCORE_THRESHOLD = 75;
const MAX_CANDIDATES_FROM_MATCHES = 10;
const MAX_DIGEST_ITEMS = 5;

async function fetchTodoInputs(userId: string) {
  const [applications, positions, stageHistories, personalTasks, contacts] = await Promise.all([
    db.application.findMany({
      where: { userId },
      include: { company: true },
      orderBy: { appliedDate: "desc" },
    }),
    db.position.findMany({
      where: { userId, status: { not: "APPLIED" } },
      include: { company: true },
    }),
    db.stageHistory.findMany({
      where: { application: { userId }, nextDeadline: { not: null } },
      include: { application: { include: { company: true } } },
    }),
    db.personalTask.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    db.contact.findMany({
      where: { userId, nextFollowUpAt: { not: null } },
      select: { id: true, name: true, companyName: true, nextFollowUpAt: true },
    }),
  ]);
  return { applications, positions, stageHistories, personalTasks, contacts };
}

export async function getTodayDigest(): Promise<DigestItem[] | null> {
  const user = await requireUser();
  const row = await db.dailyDigest.findUnique({
    where: { userId_date: { userId: user.id, date: todayKey() } },
  });
  return row ? (row.items as DigestItem[]) : null;
}

export async function generateDailyDigest(): Promise<ActionResult<DigestItem[]>> {
  return toActionResult(() => run());
}

const selectionSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), reason: z.string(), estimatedMinutes: z.number() })
  ),
});

async function run(): Promise<DigestItem[]> {
  const user = await requireUser();
  const config = await getUserAiConfig(user.id);
  if (!config) throw new UserFacingError("先去账号设置配置一个 AI Key 才能用这个功能");

  const { applications, positions, stageHistories, personalTasks, contacts } =
    await fetchTodoInputs(user.id);
  const todos = buildTodos(applications, positions, stageHistories, personalTasks, contacts);

  const topMatches = await db.positionMatch.findMany({
    where: {
      userId: user.id,
      matchScore: { gte: MATCH_SCORE_THRESHOLD },
      position: { status: { not: "APPLIED" } },
    },
    include: { position: { include: { company: true } } },
    orderBy: { matchScore: "desc" },
    take: MAX_CANDIDATES_FROM_MATCHES,
  });

  type Candidate = { id: string; label: string; sublabel: string; href: string };
  const candidates: Candidate[] = [
    ...todos.map((t) => ({ id: t.id, label: t.label, sublabel: t.sublabel, href: t.href })),
    ...topMatches.map((m) => ({
      id: `match-${m.positionId}`,
      label: `${m.position.company.name} · ${m.position.title}`,
      sublabel: `匹配度 ${m.matchScore}，${m.recommendation}，还没投`,
      href: "/pool",
    })),
  ];

  const date = todayKey();

  if (candidates.length === 0) {
    await db.dailyDigest.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: { userId: user.id, date, items: [] },
      update: { items: [] },
    });
    revalidatePath("/dashboard");
    return [];
  }

  const prompt = `你在帮一个正在校招/秋招的候选人挑出今天最值得做的事。下面是候选清单，每条有 id、标题、补充信息：

${candidates.map((c) => `- [id:${c.id}] ${c.label}；${c.sublabel}`).join("\n")}

请从里面选最多 ${MAX_DIGEST_ITEMS} 条，按今天最该优先做的顺序排列。不要只按"最近截止日期"机械排序——要综合考虑：紧迫程度、这件事本身是不是一个具体可执行的动作（比如"投递"比"再等等看"更该上榜）、如果标了匹配度的话匹配质量怎么样。每条给一句话理由，说清楚为什么今天该做这个；再给一个 estimatedMinutes（这件事大概要花多少分钟，给个粗略的整数，比如投递一般 15-30 分钟，准备一场面试可能要 45-60 分钟，联系一下内推人可能就 5-10 分钟）。

返回 items 数组，每项是 { id: 从上面候选清单里原样抄的 id, reason: 一句话理由, estimatedMinutes: 预估分钟数 }。不要编造清单里没有的 id。`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    timeoutMs: 60000,
    schema: {
      type: "OBJECT",
      properties: {
        items: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              id: { type: "STRING" },
              reason: { type: "STRING" },
              estimatedMinutes: { type: "NUMBER" },
            },
            required: ["id", "reason", "estimatedMinutes"],
          },
        },
      },
      required: ["items"],
    },
  });

  const parsed = selectionSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const items: DigestItem[] = [];
  for (const sel of parsed.data.items) {
    const candidate = byId.get(sel.id);
    if (!candidate) continue; // never trust an AI-invented id
    items.push({
      label: candidate.label,
      reason: sel.reason,
      href: candidate.href,
      estimatedMinutes: Math.max(5, Math.round(sel.estimatedMinutes)),
      done: false,
    });
  }

  await db.dailyDigest.upsert({
    where: { userId_date: { userId: user.id, date } },
    create: { userId: user.id, date, items },
    update: { items },
  });

  revalidatePath("/dashboard");
  return items;
}

/**
 * Flips one item's checked state in place — a checklist you can't check
 * anything off on isn't a checklist, it's just today's digest re-read every
 * time. Patches the stored JSON directly rather than regenerating, so
 * ticking a box never costs another AI call.
 */
export async function toggleDigestItem(index: number): Promise<ActionResult<DigestItem[]>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const date = todayKey();
    const row = await db.dailyDigest.findUnique({
      where: { userId_date: { userId: user.id, date } },
    });
    if (!row) throw new UserFacingError("今天还没生成过摘要");

    const items = row.items as DigestItem[];
    if (index < 0 || index >= items.length) throw new UserFacingError("这一项不存在");
    items[index] = { ...items[index], done: !items[index].done };

    await db.dailyDigest.update({ where: { id: row.id }, data: { items } });
    revalidatePath("/dashboard");
    return items;
  });
}
