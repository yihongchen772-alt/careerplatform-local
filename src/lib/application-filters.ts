import type { ApplicationStage } from "@prisma/client";

/**
 * Quick filters over 投递记录 — the numbers on the cards are also the way
 * in: 「面试阶段 4」 opens those four. Kept in the address (?f=) so coming
 * back from a 投递 shows the same list.
 */
export const APPLICATION_FILTERS = ["all", "active", "exam", "interview", "offer", "stale", "rejected", "closed"] as const;
export type ApplicationFilter = (typeof APPLICATION_FILTERS)[number];

/** Same threshold as the 待办's 「该催一下 HR 了」. */
export const STALE_DAYS = 14;

export const FILTER_LABELS: Record<ApplicationFilter, string> = {
  all: "全部",
  active: "进行中",
  exam: "笔试测评",
  interview: "面试中",
  offer: "Offer",
  stale: "久未更新",
  rejected: "未通过",
  closed: "已结束",
};

export const FILTER_HINTS: Record<ApplicationFilter, string> = {
  all: "所有投递",
  active: "还没结束的流程",
  exam: "测评、笔试阶段",
  interview: "一面到 HR 面",
  offer: "拿到 Offer 的（含已接受 / 已拒绝）",
  stale: `进行中、${STALE_DAYS} 天以上没有新进展`,
  rejected: "企业未通过",
  closed: "未通过、撤回、岗位取消、已接受或已拒绝",
};

const TERMINAL: ApplicationStage[] = ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"];
const EXAM: ApplicationStage[] = ["ASSESSMENT", "OA"];
const INTERVIEW: ApplicationStage[] = ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"];
const OFFER: ApplicationStage[] = ["OFFER", "ACCEPTED", "DECLINED"];

export function parseFilter(value: string | null | undefined): ApplicationFilter {
  return (APPLICATION_FILTERS as readonly string[]).includes(value ?? "") ? (value as ApplicationFilter) : "all";
}

export function matchesFilter(app: { currentStage: ApplicationStage; currentStageDate: string | Date }, filter: ApplicationFilter, now: number): boolean {
  const stage = app.currentStage;
  switch (filter) {
    case "all": return true;
    case "active": return !TERMINAL.includes(stage);
    case "exam": return EXAM.includes(stage);
    case "interview": return INTERVIEW.includes(stage);
    case "offer": return OFFER.includes(stage);
    case "stale": {
      if (TERMINAL.includes(stage)) return false;
      const since = new Date(app.currentStageDate).getTime();
      return Math.floor((now - since) / 86_400_000) >= STALE_DAYS;
    }
    case "rejected": return stage === "REJECTED";
    case "closed": return TERMINAL.includes(stage);
  }
}

export function filterCounts(apps: { currentStage: ApplicationStage; currentStageDate: string | Date }[], now: number): Record<ApplicationFilter, number> {
  const counts = Object.fromEntries(APPLICATION_FILTERS.map((filter) => [filter, 0])) as Record<ApplicationFilter, number>;
  for (const app of apps) for (const filter of APPLICATION_FILTERS) if (matchesFilter(app, filter, now)) counts[filter] += 1;
  return counts;
}
