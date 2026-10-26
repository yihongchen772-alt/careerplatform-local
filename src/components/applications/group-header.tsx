"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { ApplicationStage } from "@prisma/client";
import { filterCounts } from "@/lib/application-filters";
import { cn } from "@/lib/utils";

/** "面试 2 · Offer 1 · 进行中 6 · 已结束 3": where a section stands at a glance. */
export function groupSummary(items: { currentStage: ApplicationStage; currentStageDate: string; waiting?: boolean }[], now: number): string {
  const counts = filterCounts(items, now);
  return [
    counts.interview ? `面试 ${counts.interview}` : "",
    counts.offer ? `Offer ${counts.offer}` : "",
    counts.active ? `进行中 ${counts.active}` : "",
    counts.closed ? `已结束 ${counts.closed}` : "",
  ].filter(Boolean).join(" · ");
}

/** The bar above a section of 投递; click to fold it away. */
export function GroupHeader({
  label,
  hint,
  count,
  summary,
  collapsed,
  onToggle,
  leading,
  className,
}: {
  label: string;
  hint?: string;
  count: number;
  summary?: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Something before the name, such as 选择这一组. */
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-xl bg-muted/45 px-3 py-2", className)}>
      {leading}
      <button type="button" aria-expanded={!collapsed} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
        <span className="truncate text-sm font-semibold">{label}</span>
        <span className="shrink-0 rounded-full bg-background/80 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{count}</span>
        {hint && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{hint}</span>}
        {summary && <span className="hidden shrink-0 text-xs text-muted-foreground/80 md:inline">{summary}</span>}
      </button>
    </div>
  );
}
