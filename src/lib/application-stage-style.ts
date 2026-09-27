import type { ApplicationStage } from "@prisma/client";

/** Restrained semantic accents shared by the application board and detail view. */
export function applicationStageStyle(stage: ApplicationStage) {
  if (stage === "OFFER" || stage === "ACCEPTED") {
    return {
      dot: "bg-emerald-500",
      pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      border: "border-emerald-500/25",
    };
  }
  if (stage === "REJECTED" || stage === "DECLINED") {
    return {
      dot: "bg-rose-400",
      pill: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
      border: "border-rose-500/20",
    };
  }
  if (stage === "WITHDRAWN" || stage === "CANCELLED") {
    return {
      dot: "bg-slate-400",
      pill: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
      border: "border-slate-500/20",
    };
  }
  if (stage.startsWith("INTERVIEW") || stage === "HR_INTERVIEW") {
    return {
      dot: "bg-cyan-500",
      pill: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
      border: "border-cyan-500/25",
    };
  }
  if (stage === "OA" || stage === "ASSESSMENT") {
    return {
      dot: "bg-violet-500",
      pill: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
      border: "border-violet-500/25",
    };
  }
  return {
    dot: "bg-sky-500",
    pill: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    border: "border-sky-500/25",
  };
}
