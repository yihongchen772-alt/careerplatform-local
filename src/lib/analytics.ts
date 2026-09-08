import type { ApplicationStage } from "@prisma/client";

// Stages that mean "they actually engaged with me", not just "I applied".
const ENGAGED_STAGES: ApplicationStage[] = [
  "OA",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "INTERVIEW_3",
  "HR_INTERVIEW",
  "OFFER",
  "ACCEPTED",
];

const OFFER_STAGES: ApplicationStage[] = ["OFFER", "ACCEPTED"];

/** Groups smaller than this are shown but flagged — 1/1 is not a 100% hit rate. */
export const SMALL_SAMPLE_THRESHOLD = 5;

export type ConversionRow = {
  key: string;
  total: number;
  engaged: number;
  offers: number;
  engagedRate: number;
  offerRate: number;
  smallSample: boolean;
};

type AnalyticsApplication = {
  currentStage: ApplicationStage;
  source: string | null;
  resumeVersion: { name: string } | null;
  position: { track: string | null } | null;
  stageHistory: { stage: ApplicationStage }[];
};

// A rejected application still counts as "reached interview" if it ever got
// there, so this reads the full history rather than only the current stage —
// currentStage would report REJECTED and silently undercount every dimension.
function reachedEngaged(app: AnalyticsApplication): boolean {
  return app.stageHistory.some((h) => ENGAGED_STAGES.includes(h.stage));
}

function reachedOffer(app: AnalyticsApplication): boolean {
  return app.stageHistory.some((h) => OFFER_STAGES.includes(h.stage));
}

function summarize(key: string, apps: AnalyticsApplication[]): ConversionRow {
  const total = apps.length;
  const engaged = apps.filter(reachedEngaged).length;
  const offers = apps.filter(reachedOffer).length;
  return {
    key,
    total,
    engaged,
    offers,
    engagedRate: total > 0 ? engaged / total : 0,
    offerRate: total > 0 ? offers / total : 0,
    smallSample: total < SMALL_SAMPLE_THRESHOLD,
  };
}

function groupBy(
  apps: AnalyticsApplication[],
  keyOf: (app: AnalyticsApplication) => string | null
): ConversionRow[] {
  const buckets = new Map<string, AnalyticsApplication[]>();
  for (const app of apps) {
    const key = keyOf(app);
    if (!key) continue; // an unlabeled row would form a meaningless "未填写" cohort
    const list = buckets.get(key) ?? [];
    list.push(app);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .map(([key, list]) => summarize(key, list))
    .sort((a, b) => b.engagedRate - a.engagedRate || b.total - a.total);
}

export function computeConversion(apps: AnalyticsApplication[]) {
  return {
    bySource: groupBy(apps, (a) => a.source),
    byResume: groupBy(apps, (a) => a.resumeVersion?.name ?? null),
    byTrack: groupBy(apps, (a) => a.position?.track ?? null),
  };
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

/// Canonical funnel order — distinct from applicationStageValues (which is
/// just the enum's declaration order for form pickers). REJECTED/ACCEPTED/
/// DECLINED are terminal outcomes, not funnel steps of their own; see
/// FUNNEL_RANK below for how they're folded in.
export const FUNNEL_STAGES: { stage: ApplicationStage; label: string }[] = [
  { stage: "APPLIED", label: "投递" },
  { stage: "SCREENING", label: "简历筛选" },
  { stage: "ASSESSMENT", label: "笔试/测评" },
  { stage: "INTERVIEW_1", label: "一面" },
  { stage: "INTERVIEW_2", label: "二面" },
  { stage: "INTERVIEW_3", label: "三面" },
  { stage: "HR_INTERVIEW", label: "HR 面" },
  { stage: "OFFER", label: "Offer" },
];

const FUNNEL_RANK = new Map<ApplicationStage, number>(
  FUNNEL_STAGES.map((s, i) => [s.stage, i])
);
// ACCEPTED/DECLINED both mean an offer was already on the table, so for "how
// far did this application get" purposes they rank alongside OFFER. REJECTED
// gets no rank of its own — its real high-water mark is whatever funnel
// stage came before it in the history log.
FUNNEL_RANK.set("ACCEPTED", FUNNEL_RANK.get("OFFER")!);
FUNNEL_RANK.set("DECLINED", FUNNEL_RANK.get("OFFER")!);

// Every application starts at APPLIED (rank 0) by definition, whether or not
// that transition happens to have its own StageHistory row.
function highWaterRank(app: AnalyticsApplication): number {
  let max = 0;
  for (const h of app.stageHistory) {
    const rank = FUNNEL_RANK.get(h.stage);
    if (rank !== undefined && rank > max) max = rank;
  }
  return max;
}

export type FunnelStep = {
  stage: ApplicationStage;
  label: string;
  reached: number;
  /// Share that did NOT make it from the previous step to this one. null for
  /// the first step (nothing to drop from) and when the previous step had
  /// zero applications (division has no meaning).
  dropRate: number | null;
  smallSample: boolean;
};

/**
 * Cumulative funnel counts — "reached SCREENING" includes every application
 * that got further than that too, using each application's high-water rank
 * rather than requiring a literal StageHistory row for every stage. That
 * matters because real pipelines skip steps (some postings have no written
 * test, some go straight to a technical round) — counting a skipped
 * checkpoint as a "drop" would misreport a normal fast-track as a rejection.
 */
export function computeFunnel(apps: AnalyticsApplication[]): FunnelStep[] {
  const ranks = apps.map(highWaterRank);
  const reachedCounts = FUNNEL_STAGES.map((_, i) => ranks.filter((r) => r >= i).length);
  return FUNNEL_STAGES.map((s, i) => ({
    stage: s.stage,
    label: s.label,
    reached: reachedCounts[i],
    dropRate:
      i === 0 || reachedCounts[i - 1] === 0
        ? null
        : 1 - reachedCounts[i] / reachedCounts[i - 1],
    smallSample: reachedCounts[i] < SMALL_SAMPLE_THRESHOLD,
  }));
}
