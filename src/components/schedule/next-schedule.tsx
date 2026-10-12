"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Hourglass } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeText, urgencyOf, whenText, type ScheduleItem, type StepView } from "@/lib/interview-schedule";
import { MeetingActions } from "@/components/schedule/meeting-actions";
import { completeStep } from "@/components/schedule/step-actions";

const TONE = {
  now: "text-emerald-700 dark:text-emerald-300 font-semibold",
  today: "text-amber-700 dark:text-amber-300 font-medium",
  soon: "text-foreground/85",
  later: "text-muted-foreground",
  past: "text-muted-foreground",
} as const;

/**
 * 「一面 · 今天 14:00 · 还有 35 分钟 [进入会议]」 on a card or a list row.
 * A missed deadline stays amber, a finished interview goes grey.
 */
export function NextScheduleLine({ item, now, href, className }: { item: ScheduleItem; now: number; href: string; className?: string }) {
  const urgency = urgencyOf(item, now);
  const tone = urgency === "past" && !item.hasTime ? "text-amber-700 dark:text-amber-400" : TONE[urgency];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs", className)}>
      <Link href={href} className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 hover:underline", tone)} title={item.meetingInfo ?? undefined}>
        {urgency === "now" ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" /> : <CalendarClock className="size-3.5 shrink-0" />}
        <span className="truncate">{item.title} · {whenText(item, now)}</span>
        <span className="shrink-0">· {relativeText(item, now)}</span>
      </Link>
      {urgency !== "past" && <MeetingActions info={item.meetingInfo} size="xs" compact />}
    </div>
  );
}

/**
 * The line under a 投递 on the board / list: 等结果 once the round is done,
 * a missed 笔试 deadline with 「已完成」, else the next time.
 */
export function ProgressLine({ applicationId, step, next, now, className }: { applicationId: string; step: StepView | null; next: ScheduleItem | null; now: number; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const href = `/applications/${applicationId}#interview`;
  if (step?.phase === "waiting") {
    return (
      <Link href={href} className={cn("flex items-center gap-1.5 text-xs hover:underline", step.followUp ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground", className)}>
        {step.followUp ? <Hourglass className="size-3.5 shrink-0" /> : <CheckCircle2 className="size-3.5 shrink-0" />}
        <span className="truncate">{step.text}</span>
      </Link>
    );
  }
  if (step?.phase === "due") {
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400", className)}>
        <Link href={href} className="inline-flex items-center gap-1.5 hover:underline"><CalendarClock className="size-3.5 shrink-0" />{step.text}</Link>
        <button
          type="button"
          disabled={busy}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-amber-500/40 bg-card px-2 text-[11px] font-medium text-amber-800 hover:bg-amber-500/10 dark:text-amber-200"
          onClick={async () => { setBusy(true); try { await completeStep(step.rowId, () => router.refresh()); } finally { setBusy(false); } }}
        >
          <CheckCircle2 className="size-3" />已完成
        </button>
      </div>
    );
  }
  if (next) return <NextScheduleLine item={next} now={now} href={href} className={className} />;
  return null;
}
