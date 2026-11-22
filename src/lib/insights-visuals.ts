import type { ApplicationStage } from "@prisma/client";

export type SankeyFlowApp = {
  currentStage: ApplicationStage;
  appliedDate: Date | string;
  stageHistory: { stage: ApplicationStage }[];
  companyName?: string;
};

export type SankeyLink = {
  from: string;
  to: string;
  value: number;
  color: string;
};

export type SankeyData = {
  total: number;
  examCount: number;
  interview1Count: number;
  interview2Count: number;
  offerCount: number;
  rejectedCount: number;
  activeCount: number;
  links: SankeyLink[];
};

const EXAM_STAGES = new Set<ApplicationStage>(["OA", "ASSESSMENT"]);
const INTERVIEW1_STAGES = new Set<ApplicationStage>(["AI_INTERVIEW", "INTERVIEW_1"]);
const INTERVIEW2_PLUS_STAGES = new Set<ApplicationStage>(["INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"]);
const OFFER_STAGES = new Set<ApplicationStage>(["OFFER", "ACCEPTED", "DECLINED"]);
const TERMINAL_FAIL = new Set<ApplicationStage>(["REJECTED", "WITHDRAWN", "CANCELLED"]);

/**
 * Computes exact Sankey funnel flows across all applications so every single
 * application's journey sums cleanly to 100% of total submissions.
 */
export function buildSankeyData(apps: SankeyFlowApp[]): SankeyData {
  let total = 0;
  let toExam = 0;
  let directToInterview = 0;
  let screenFail = 0;
  let screenPending = 0;

  let examToInterview = 0;
  let examFail = 0;
  let examPending = 0;

  let i1ToI2 = 0;
  let i1DirectOffer = 0;
  let i1Fail = 0;
  let i1Pending = 0;

  let i2ToOffer = 0;
  let i2Fail = 0;
  let i2Pending = 0;

  let rejectedCount = 0;
  let offerCount = 0;

  for (const app of apps) {
    total++;
    const allStages = new Set<ApplicationStage>([app.currentStage, ...app.stageHistory.map((s) => s.stage)]);
    const hadExam = [...allStages].some((s) => EXAM_STAGES.has(s));
    const hadI1 = [...allStages].some((s) => INTERVIEW1_STAGES.has(s));
    const hadI2 = [...allStages].some((s) => INTERVIEW2_PLUS_STAGES.has(s));
    const hadOffer = [...allStages].some((s) => OFFER_STAGES.has(s));
    const isFail = TERMINAL_FAIL.has(app.currentStage) && !hadOffer;

    if (hadOffer) offerCount++;
    if (isFail) rejectedCount++;

    const reachedAnyInterview = hadI1 || hadI2 || hadOffer;
    if (hadExam) {
      toExam++;
      if (reachedAnyInterview) examToInterview++;
      else if (isFail) examFail++;
      else examPending++;
    } else if (reachedAnyInterview) {
      directToInterview++;
    } else if (isFail) {
      screenFail++;
    } else {
      screenPending++;
    }

    if (reachedAnyInterview) {
      if (hadI2) {
        i1ToI2++;
        if (hadOffer) i2ToOffer++;
        else if (isFail) i2Fail++;
        else i2Pending++;
      } else if (hadOffer) {
        i1DirectOffer++;
      } else if (isFail) {
        i1Fail++;
      } else {
        i1Pending++;
      }
    }
  }

  const rawLinks: SankeyLink[] = [
    { from: "总投递", to: "笔试/测评", value: toExam, color: "#6366f1" },
    { from: "总投递", to: "进入面试", value: directToInterview, color: "#0ea5e9" },
    { from: "总投递", to: "初筛待定", value: screenPending, color: "#94a3b8" },
    { from: "总投递", to: "初筛终止", value: screenFail, color: "#f43f5e" },

    { from: "笔试/测评", to: "进入面试", value: examToInterview, color: "#0ea5e9" },
    { from: "笔试/测评", to: "笔测待定", value: examPending, color: "#94a3b8" },
    { from: "笔试/测评", to: "笔测终止", value: examFail, color: "#f43f5e" },

    { from: "进入面试", to: "二面/终面", value: i1ToI2, color: "#8b5cf6" },
    { from: "进入面试", to: "拿到 Offer", value: i1DirectOffer, color: "#10b981" },
    { from: "进入面试", to: "一面待定", value: i1Pending, color: "#94a3b8" },
    { from: "进入面试", to: "一面终止", value: i1Fail, color: "#f43f5e" },

    { from: "二面/终面", to: "拿到 Offer", value: i2ToOffer, color: "#10b981" },
    { from: "二面/终面", to: "终面待定", value: i2Pending, color: "#94a3b8" },
    { from: "二面/终面", to: "终面终止", value: i2Fail, color: "#f43f5e" },
  ];

  return {
    total,
    examCount: toExam,
    interview1Count: directToInterview + examToInterview,
    interview2Count: i1ToI2,
    offerCount,
    rejectedCount,
    activeCount: Math.max(0, total - offerCount - rejectedCount),
    links: rawLinks.filter((l) => l.value > 0),
  };
}

export type HeatmapDay = {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
};

export type ActivityHeatmapData = {
  days: HeatmapDay[];
  totalInWindow: number;
  activeDays: number;
  longestStreak: number;
  peakDay: { date: string; count: number } | null;
};

function ymdLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Builds a GitHub-style daily application submission heatmap for the past N weeks. */
export function buildActivityHeatmap(apps: { appliedDate: Date | string }[], weeks = 18, now = new Date()): ActivityHeatmapData {
  const counts = new Map<string, number>();
  for (const app of apps) {
    const d = app.appliedDate instanceof Date ? app.appliedDate : new Date(app.appliedDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = ymdLocal(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const totalDays = weeks * 7;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: HeatmapDay[] = [];
  let maxCount = 0;
  let totalInWindow = 0;
  let activeDays = 0;
  let longestStreak = 0;
  let currentStreak = 0;
  let peakDay: { date: string; count: number } | null = null;

  for (let i = totalDays - 1; i >= 0; i--) {
    const cur = new Date(end);
    cur.setDate(end.getDate() - i);
    const key = ymdLocal(cur);
    const count = counts.get(key) ?? 0;
    if (count > maxCount) {
      maxCount = count;
      peakDay = { date: key, count };
    }
    if (count > 0) {
      totalInWindow += count;
      activeDays++;
      currentStreak++;
      if (currentStreak > longestStreak) longestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
    days.push({ date: key, count, level: 0 });
  }

  for (const day of days) {
    if (day.count === 0) day.level = 0;
    else if (maxCount <= 2) day.level = day.count === 1 ? 2 : 4;
    else {
      const ratio = day.count / maxCount;
      day.level = ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
    }
  }

  return { days, totalInWindow, activeDays, longestStreak, peakDay };
}
