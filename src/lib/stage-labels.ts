import type { ApplicationStage, PositionStatus } from "@prisma/client";

export const STAGE_ORDER: ApplicationStage[] = [
  "APPLIED",
  "SCREENING",
  "ASSESSMENT",
  "OA",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "INTERVIEW_3",
  "HR_INTERVIEW",
  "OFFER",
  "REJECTED",
  "ACCEPTED",
  "DECLINED",
];

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  APPLIED: "已投递",
  SCREENING: "简历筛选中",
  ASSESSMENT: "测评",
  OA: "笔试",
  INTERVIEW_1: "一面",
  INTERVIEW_2: "二面",
  INTERVIEW_3: "三面",
  HR_INTERVIEW: "HR 面",
  OFFER: "Offer",
  REJECTED: "已拒绝(公司)",
  ACCEPTED: "已接受",
  DECLINED: "已拒绝(本人)",
};

export const STAGE_BADGE_VARIANT: Record<
  ApplicationStage,
  "default" | "secondary" | "destructive" | "outline"
> = {
  APPLIED: "secondary",
  SCREENING: "secondary",
  ASSESSMENT: "outline",
  OA: "outline",
  INTERVIEW_1: "outline",
  INTERVIEW_2: "outline",
  INTERVIEW_3: "outline",
  HR_INTERVIEW: "outline",
  OFFER: "default",
  REJECTED: "destructive",
  ACCEPTED: "default",
  DECLINED: "destructive",
};

export const POSITION_STATUS_LABELS: Record<PositionStatus, string> = {
  EVALUATING: "待评估",
  PLANNED: "计划投递",
  APPLIED: "已投递",
  DROPPED: "已放弃",
};
