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
