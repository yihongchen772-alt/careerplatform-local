"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useListOrder } from "@/components/applications/list-order";

/**
 * 返回 the list as it was (filter, search, sort), and step through it with
 * 上一条 / 下一条 or ← → — no trip back to the list between 投递.
 */
export function ApplicationPager({ id, fallbackIds }: { id: string; fallbackIds: string[] }) {
  const router = useRouter();
  const stored = useListOrder();
  const order = stored && stored.ids.includes(id) ? stored : { ids: fallbackIds, href: "/applications", label: "" };
  const index = order.ids.indexOf(id);
  const previous = index > 0 ? order.ids[index - 1] : null;
  const next = index >= 0 && index < order.ids.length - 1 ? order.ids[index + 1] : null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      const goTo = event.key === "ArrowLeft" ? previous : next;
      if (!goTo) return;
      event.preventDefault();
      router.push(`/applications/${goTo}`);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previous, next, router]);

  const step = "inline-flex h-7 items-center gap-0.5 rounded-full border border-border/70 bg-background/60 px-2.5 text-xs font-medium transition-colors";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Link href={order.href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        返回投递记录{order.label ? `（${order.label}）` : ""}
      </Link>
      {index >= 0 && order.ids.length > 1 && (
        <nav className="flex items-center gap-1.5" aria-label="上一条 / 下一条投递">
          {previous ? <Link href={`/applications/${previous}`} className={cn(step, "hover:bg-muted")} title="上一条（←）"><ChevronLeft className="size-3.5" />上一条</Link> : <span className={cn(step, "opacity-40")}><ChevronLeft className="size-3.5" />上一条</span>}
          <span className="px-1 text-xs tabular-nums text-muted-foreground">{index + 1} / {order.ids.length}</span>
          {next ? <Link href={`/applications/${next}`} className={cn(step, "hover:bg-muted")} title="下一条（→）">下一条<ChevronRight className="size-3.5" /></Link> : <span className={cn(step, "opacity-40")}>下一条<ChevronRight className="size-3.5" /></span>}
        </nav>
      )}
    </div>
  );
}
