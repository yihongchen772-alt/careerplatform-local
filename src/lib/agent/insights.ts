import { db } from "@/lib/db";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { isTerminalStage } from "@/lib/interview-schedule";

/**
 * Synthesizes a compact, zero-LLM-cost cross-session coaching profile from the
 * user's real history: where applications stall or get rejected, top recurring
 * interview question categories, and urgent 48h deadlines.
 * Injected into 小欧's system prompt so it remembers the user's real bottlenecks
 * without extra tool calls.
 */
export async function buildCoachingInsights(userId: string, now = new Date()): Promise<string> {
  const [rejectedStages, noteExtracts, postmortems, upcomingApps] = await Promise.all([
    db.stageHistory.findMany({
      where: {
        application: { userId },
        stage: "REJECTED",
      },
      select: { terminatedAtStage: true, terminatedAtStageLabel: true },
      take: 80,
    }),
    db.interviewNoteExtract.findMany({
      where: { userId },
      select: { questions: true },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    db.stagePostmortem.findMany({
      where: { userId },
      select: { content: true, stageHistory: { select: { stage: true, application: { select: { company: { select: { name: true } } } } } } },
      orderBy: { updatedAt: "desc" },
      take: 6,
    }),
    db.application.findMany({
      where: { userId },
      select: {
        currentStage: true,
        currentStageDate: true,
        stageHistory: {
          where: { nextDeadline: { not: null }, completedAt: null },
          select: { nextDeadline: true, stage: true },
        },
      },
    }),
  ]);

  const lines: string[] = [];

  // 1. Rejection bottleneck breakdown
  if (rejectedStages.length >= 2) {
    const counts = new Map<string, number>();
    for (const row of rejectedStages) {
      const key =
        row.terminatedAtStageLabel?.trim() ||
        (row.terminatedAtStage && row.terminatedAtStage in STAGE_LABELS
          ? STAGE_LABELS[row.terminatedAtStage as keyof typeof STAGE_LABELS]
          : "投递/初筛阶段");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length) {
      lines.push(
        `- 历史淘汰高频环节（共 ${rejectedStages.length} 次）：${top.map(([k, v]) => `${k} ${v} 次`).join("、")}`
      );
    }
  }

  // 2. Recurring interview question categories
  const catCounts = new Map<string, number>();
  for (const ext of noteExtracts) {
    if (!Array.isArray(ext.questions)) continue;
    for (const item of ext.questions as Array<{ category?: unknown }>) {
      const cat = typeof item?.category === "string" ? item.category.trim() : "";
      if (cat) catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    }
  }
  const topCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (topCats.length) {
    lines.push(
      `- 历史面经高频考察维度：${topCats.map(([c, n]) => `${c}（${n} 题）`).join("、")}`
    );
  }

  // 3. Recent AI postmortem weak spots (if structured)
  const weakHints: string[] = [];
  for (const pm of postmortems) {
    const c = pm.content as Record<string, unknown> | null;
    if (!c || typeof c !== "object") continue;
    const gaps = Array.isArray(c.gaps) ? c.gaps : Array.isArray(c.weaknesses) ? c.weaknesses : Array.isArray(c.improvements) ? c.improvements : [];
    for (const g of gaps) {
      const s = typeof g === "string" ? g.trim() : typeof (g as { point?: unknown })?.point === "string" ? String((g as { point: string }).point).trim() : "";
      if (s && weakHints.length < 3) weakHints.push(`${pm.stageHistory.application.company.name}：${s.slice(0, 48)}`);
    }
  }
  if (weakHints.length) {
    lines.push(`- 近期面试复盘暴露的短板：${weakHints.join("；")}`);
  }

  // 4. Urgent 48h events & stale count
  const nowMs = now.getTime();
  let urgent48h = 0;
  let stale14d = 0;
  for (const app of upcomingApps) {
    if (isTerminalStage(app.currentStage)) continue;
    if (nowMs - app.currentStageDate.getTime() >= 14 * 86_400_000) stale14d++;
    for (const st of app.stageHistory) {
      if (!st.nextDeadline) continue;
      const diff = st.nextDeadline.getTime() - nowMs;
      if (diff >= -2 * 3_600_000 && diff <= 48 * 3_600_000) urgent48h++;
    }
  }
  if (urgent48h > 0 || stale14d >= 3) {
    lines.push(
      `- 当前节奏提示：${[urgent48h ? `未来 48 小时有 ${urgent48h} 场待完成笔面试` : null, stale14d >= 3 ? `${stale14d} 条进行中投递已超过 14 天未更新` : null].filter(Boolean).join("；")}`
    );
  }

  return lines.join("\n");
}
