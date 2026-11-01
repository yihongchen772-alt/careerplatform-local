import type { ScheduleKind } from "@/lib/interview-schedule";

/** One color per kind of 安排, the same on 接下来, 日历 and wherever else they are listed. */
export const KIND_STYLE: Record<ScheduleKind, string> = {
  interview: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  exam: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  deadline: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  event: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
};
