import { daysUntil } from "@/lib/reminders";
import { SMALL_SAMPLE_THRESHOLD, type ConversionRow } from "@/lib/analytics";

export type OpportunityTier = "fire" | "focus" | "safe" | "hold";

export const TIER_META: Record<OpportunityTier, { emoji: string; label: string }> = {
  fire: { emoji: "🔥", label: "立即投" },
  focus: { emoji: "⭐", label: "重点准备" },
  safe: { emoji: "🟢", label: "保底" },
  hold: { emoji: "⚪", label: "暂缓" },
};

export type OpportunityScore = {
  score: number;
  tier: OpportunityTier;
  reasons: string[];
};

type ScoreInput = {
  matchScore: number | null;
  track: string | null;
  deadline: Date | null;
  /** From the "投递就绪" checklist (task #16) — how much prep is already
   * done, 0-4. Used as an inverse proxy for remaining prep cost. */
  readinessCount: number;
  readinessTotal: number;
};

/**
 * Deterministic, fully explainable — no AI call. "成功概率不能只让 LLM
 * 瞎猜" cuts both ways: it also means this tier assignment itself must be
 * arithmetic on real numbers, not a model's guess, and every number that
 * went into it is surfaced in `reasons` rather than hidden behind a single
 * opaque score.
 */
export function computeOpportunityScore(
  input: ScoreInput,
  historyByTrack: Map<string, ConversionRow>
): OpportunityScore {
  const reasons: string[] = [];

  const matchComponent = input.matchScore ?? 50;
  reasons.push(
    input.matchScore !== null
      ? `匹配 ${input.matchScore} 分`
      : "还没跑过 AI 匹配（按中性分 50 估算）"
  );

  const history = input.track ? historyByTrack.get(input.track) : undefined;
  let historyComponent = 50;
  if (history && !history.smallSample) {
    historyComponent = history.engagedRate * 100;
    reasons.push(
      `「${input.track}」方向历史进面率 ${Math.round(history.engagedRate * 100)}%（${history.total} 次投递）`
    );
  } else if (history && history.smallSample) {
    reasons.push(
      `「${input.track}」方向只投过 ${history.total} 次（不足 ${SMALL_SAMPLE_THRESHOLD} 次），历史数据还不够参考，按中性分估算`
    );
  } else {
    reasons.push(input.track ? `「${input.track}」方向还没有历史投递数据，按中性分估算` : "没填方向，无法参考历史数据");
  }

  const readinessComponent =
    input.readinessTotal > 0 ? (input.readinessCount / input.readinessTotal) * 100 : 0;
  reasons.push(`投递材料准备度 ${input.readinessCount}/${input.readinessTotal}`);

  const score = Math.round(matchComponent * 0.5 + historyComponent * 0.3 + readinessComponent * 0.2);

  const daysLeft = input.deadline ? daysUntil(input.deadline) : null;
  if (daysLeft !== null) {
    reasons.push(daysLeft < 0 ? "已过截止日期" : `${daysLeft} 天后截止`);
  } else {
    reasons.push("没有截止日期");
  }

  let tier: OpportunityTier;
  if (score >= 70 && daysLeft !== null && daysLeft >= 0 && daysLeft <= 10) {
    tier = "fire";
  } else if (score >= 70) {
    tier = "focus";
  } else if (score >= 45) {
    tier = "safe";
  } else {
    tier = "hold";
  }

  return { score, tier, reasons };
}
