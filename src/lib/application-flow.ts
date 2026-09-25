import type { ApplicationStage } from "@prisma/client";

const TERMINAL = new Set<ApplicationStage>(["REJECTED", "ACCEPTED", "DECLINED"]);
const ORDER: ApplicationStage[] = ["APPLIED", "SCREENING", "ASSESSMENT", "OA", "INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER"];

export type PortalTransition = "none" | "apply" | "review";

/** Only explicit outcome wording counts; silence or a removed job does not. */
export function isExplicitRejectionStatus(status: string): boolean {
  return /未通过|未录用|已淘汰|流程终止|申请失败|不予录用|已拒绝|不合适|很遗憾|rejected|unsuccessful|not selected|not moving forward/i.test(status);
}

/** A broad-stage order is a safety hint, not a company's actual workflow. */
export function classifyPortalTransition(current: ApplicationStage, next: ApplicationStage | null): PortalTransition {
  if (!next || current === next || TERMINAL.has(current) || next === "ACCEPTED" || next === "DECLINED") return "none";
  if (next === "REJECTED" || next === "OFFER") return "review";
  const from = ORDER.indexOf(current);
  const to = ORDER.indexOf(next);
  if (from < 0 || to < 0) return "none";
  return to > from ? "apply" : "review";
}
