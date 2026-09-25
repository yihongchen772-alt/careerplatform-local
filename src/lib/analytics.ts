import type { ApplicationStage } from "@prisma/client";
import { SMALL_SAMPLE_THRESHOLD, type FunnelApplication } from "@/lib/funnel";

// Re-exported so existing `from "@/lib/analytics"` imports elsewhere keep
// working — the actual constant is owned by funnel.ts, see the comment
// there for why (breaking a circular import between the two files).
export { SMALL_SAMPLE_THRESHOLD };

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
    byTrack: groupBy(apps, (a) => a.position?.track ?? null),
  };
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

// The stage-by-stage funnel (APPLIED → ... → OFFER) lives in src/lib/funnel.ts,
// shared by /dashboard and /insights — it is not duplicated here.

export type ResumeComparisonRow = {
  name: string;
  total: number;
  assessment: number;
  interview: number;
  offers: number;
  assessmentRate: number;
  interviewRate: number;
  offerRate: number;
  smallSample: boolean;
};

const ASSESSMENT_STAGES: ApplicationStage[] = ["ASSESSMENT", "OA"];
const INTERVIEW_STAGES: ApplicationStage[] = ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"];

/**
 * Per-resume-version breakdown with a "笔试" (assessment) column the generic
 * ConversionRow above doesn't have — the whole point of comparing resume
 * versions is seeing which actual steps occurred. Do not assume that an
 * interview implies a prior written test or assessment.
 */
export function computeResumeComparison(
  apps: (FunnelApplication & { resumeVersion: { name: string } | null })[]
): ResumeComparisonRow[] {
  const buckets = new Map<string, typeof apps>();
  for (const app of apps) {
    const name = app.resumeVersion?.name;
    if (!name) continue;
    const list = buckets.get(name) ?? [];
    list.push(app);
    buckets.set(name, list);
  }
  return [...buckets.entries()]
    .map(([name, list]) => {
      const total = list.length;
      const assessment = list.filter((a) => a.stageHistory.some((h) => ASSESSMENT_STAGES.includes(h.stage))).length;
      const interview = list.filter((a) => a.stageHistory.some((h) => INTERVIEW_STAGES.includes(h.stage))).length;
      // Offers use the same OFFER_STAGES definition as the rest of this
      // file (folds in ACCEPTED), not reachedStage — an application logged
      // straight to ACCEPTED with no separate OFFER row shouldn't undercount.
      const offers = list.filter((a) =>
        a.stageHistory.some((h) => OFFER_STAGES.includes(h.stage))
      ).length;
      return {
        name,
        total,
        assessment,
        interview,
        offers,
        assessmentRate: total > 0 ? assessment / total : 0,
        interviewRate: total > 0 ? interview / total : 0,
        offerRate: total > 0 ? offers / total : 0,
        smallSample: total < SMALL_SAMPLE_THRESHOLD,
      };
    })
    .sort((a, b) => b.interviewRate - a.interviewRate || b.total - a.total);
}
