"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeText, urgencyOf, whenText, type ScheduleItem } from "@/lib/interview-schedule";
import { MeetingActions } from "@/components/schedule/meeting-actions";

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
