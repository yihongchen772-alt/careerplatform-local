"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lookupApplicationCities, undoApplicationCities, type CityFill } from "@/lib/actions/city-lookup";

type Run = { state: "running" | "done"; checked: number; total: number; filled: CityFill[] };

/**
 * 投递 with no city get one on their own: on opening the page, any not yet
 * looked up are read from their JD, their job page and a web search, a few at
 * a time, and the result can be taken back in one click.
 */
export function CityLookupBar({ missing, pending, showList }: { missing: number; pending: number; showList: boolean }) {
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [hidden, setHidden] = useState(false);
  const alive = useRef(true);
  const started = useRef(false);

  async function lookup(since?: number) {
    if (run?.state === "running") return;
    setHidden(false);
    const total = since ? missing : pending;
    let current: Run = { state: "running", checked: 0, total, filled: [] };
    setRun(current);
    try {
      while (alive.current) {
        const result = await lookupApplicationCities({ since });
        if (!result.ok) {
          toast.error(result.message);
          break;
        }
        const { filled, tried, left } = result.data;
        current = { ...current, checked: current.checked + tried, total: Math.max(current.total, current.checked + tried + left), filled: [...current.filled, ...filled] };
        setRun(current);
        if (filled.length) router.refresh();
        if (!tried || !left) break;
      }
    } finally {
      if (alive.current) setRun({ ...current, state: "done" });
    }
  }

  useEffect(() => {
    alive.current = true;
    if (pending > 0 && !started.current) {
      started.current = true;
      void lookup();
    }
    return () => { alive.current = false; };
    // Once per visit, for what was pending when the page opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function undo(filled: CityFill[]) {
    const result = await undoApplicationCities(filled);
    if (!result.ok) return void toast.error(result.message);
    toast.success("已撤销，这些投递回到没有城市的状态");
    setRun(null);
    router.refresh();
  }

  if (run?.state === "running") {
    return (
      <Bar>
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        <span>正在自动补工作城市（读 JD、打开岗位页面、联网搜索）… 已查 {run.checked} / {run.total}{run.filled.length ? `，补上 ${run.filled.length} 条` : ""}</span>
      </Bar>
    );
  }

  if (run && !hidden) {
    const by = (source: CityFill["source"]) => run.filled.filter((fill) => fill.source === source).length;
    // From this run, not the page's count, which catches up only after the refresh lands.
    const unfound = run.checked - run.filled.length;
    const parts = [["岗位页面", by("岗位页面")], ["JD", by("JD")], ["联网搜索", by("联网搜索")], ["按公司推测", by("公司所在地")]].filter(([, count]) => count).map(([label, count]) => `${label} ${count}`);
    return (
      <Bar>
        <MapPin className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          {run.filled.length ? `已自动补上 ${run.filled.length} 条投递的城市（${parts.join(" · ")}）。` : "这次没有查到新的城市。"}
          {by("公司所在地") > 0 && " 推测的在列表里标了「推测」。"}
          {unfound > 0 && ` 还有 ${unfound} 条没查到，可以在投递里手填。`}
        </span>
        {run.filled.length > 0 && <Button type="button" size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => void undo(run.filled)}>撤销</Button>}
        {unfound > 0 && <Button type="button" size="sm" variant="ghost" className="h-7 rounded-full text-xs" onClick={() => void lookup(Date.now())}>再查一次</Button>}
        <button type="button" aria-label="关闭" onClick={() => setHidden(true)} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button>
      </Bar>
    );
  }

  // Listing by city: the 未标城市 ones can be looked up again by hand.
  if (showList && missing > 0) {
    return (
      <Bar>
        <MapPin className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">有 {missing} 条投递还没有城市。</span>
        <Button type="button" size="sm" variant="outline" className="h-7 rounded-full text-xs" onClick={() => void lookup(Date.now())}>联网查城市</Button>
      </Bar>
    );
  }
  return null;
}

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="surface-card flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-sm" role="status">{children}</div>;
}
