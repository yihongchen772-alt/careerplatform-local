"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BriefcaseBusiness, CircleX, LayoutGrid, List, MessagesSquare, Search, SearchX, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { matchApplication, type ApplicationHits } from "@/lib/application-search";
import { useStoredChoice } from "@/components/applications/use-stored-choice";
import {
  ApplicationsTable,
  type ApplicationRow,
} from "@/components/applications/applications-table";
import { ApplicationsBoard } from "@/components/applications/applications-board";
import { PortalReviewBanner } from "@/components/applications/portal-review-banner";

/**
 * Board and table over the same data. The board answers "where am I stuck",
 * the table answers "what did I apply to and when" — both are worth having,
 * and neither replaces the other, so this is a toggle rather than a
 * migration away from the table.
 */
const VIEWS = ["board", "table"] as const;

export function ApplicationsView({ applications }: { applications: ApplicationRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useStoredChoice("careerplatform.applications.view", VIEWS, "board");
  // What the box shows, and what the lists are filtered by. They differ only
  // while a Chinese input method is composing, whose pinyin letters would
  // otherwise flash through the filter.
  const urlQuery = searchParams.get("q") ?? "";
  const [draft, setDraft] = useState(urlQuery);
  const [query, setQuery] = useState(urlQuery);
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  // Opened again with another ?q= (from ⌘K search, say) while already here.
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery);
    if (urlQuery !== query.trim()) {
      setDraft(urlQuery);
      setQuery(urlQuery);
    }
  }
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit(value: string) {
    setQuery(value);
    // In the address too, so coming back from a 投递 shows the same results.
    const params = new URLSearchParams(window.location.search);
    if (value.trim()) params.set("q", value.trim());
    else params.delete("q");
    const search = params.toString();
    window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
  }

  const term = query.trim();
  const hits = useMemo(() => {
    if (!term) return null;
    const found = new Map<string, ApplicationHits>();
    for (const app of applications) {
      const hit = matchApplication({ companyName: app.company.name, aliases: app.company.aliases?.map((entry) => entry.alias), title: app.title }, term);
      if (hit) found.set(app.id, hit);
    }
    return found;
  }, [applications, term]);
  const shown = hits ? applications.filter((app) => hits.has(app.id)) : applications;
  const companies = new Set(shown.map((app) => app.company.name)).size;

  // "/" or ⌘F / Ctrl+F jumps to the search box, as in a browser.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const find = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f";
      const slash = event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!find && !slash) return;
      // Not from under a dialog or menu.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const active = applications.filter((a) => !["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"].includes(a.currentStage)).length;
  const interviews = applications.filter((a) => a.currentStage.startsWith("INTERVIEW") || a.currentStage === "HR_INTERVIEW").length;
  const offers = applications.filter((a) => a.currentStage === "OFFER" || a.currentStage === "ACCEPTED").length;
  const rejected = applications.filter((a) => a.currentStage === "REJECTED").length;
  const metrics = [
    { label: "累计投递", value: applications.length, icon: BriefcaseBusiness, caption: "所有投递记录" },
    { label: "进行中", value: active, icon: Sparkles, caption: "仍在推进的机会" },
    { label: "面试阶段", value: interviews, icon: MessagesSquare, caption: "值得重点准备" },
    { label: "未通过", value: rejected, icon: CircleX, caption: offers > 0 ? `另有 ${offers} 个 Offer / 已接受` : "公司结束的流程" },
  ];

  return (
    <div className="space-y-6">
      <PortalReviewBanner items={applications.filter((a) => a.portalSuggestedStage).map((a) => ({
        id: a.id,
        companyName: a.company.name,
        title: a.title,
        currentStage: a.currentStage,
        suggestedStage: a.portalSuggestedStage!,
        portalStatus: a.portalStatus ?? null,
      }))} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="relative overflow-hidden rounded-[1.35rem] border border-border/70 bg-card/75 p-4 shadow-[0_10px_30px_-24px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
                <span className="flex size-8 items-center justify-center rounded-xl bg-primary/8 text-primary"><Icon className="size-4" /></span>
              </div>
              <p className="mt-4 text-3xl font-semibold tracking-[-0.055em] tabular-nums sm:text-4xl">{metric.value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{metric.caption}</p>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">进度视图</h2>
          <p className="mt-1 text-xs text-muted-foreground">把每次投递放在它当前所处的位置，下一步一眼可见。</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {applications.length > 0 && <div className="relative w-full sm:w-80" role="search">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            value={draft}
            aria-label="搜索投递记录"
            placeholder="搜公司或岗位，拼音首字母也行（zjtd）"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              if (!composing.current) commit(event.target.value);
            }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => {
              composing.current = false;
              commit(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                if (!draft) { event.currentTarget.blur(); return; }
                event.preventDefault();
                setDraft("");
                commit("");
              }
              // One match: open it straight away.
              if (event.key === "Enter" && term && shown.length === 1) {
                event.preventDefault();
                router.push(`/applications/${shown[0].id}`);
              }
            }}
            className="h-9 w-full rounded-full border border-border/70 bg-card/75 pl-9 pr-9 text-sm shadow-sm outline-none backdrop-blur-xl transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
          />
          {draft ? (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => { setDraft(""); commit(""); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border/80 px-1.5 font-sans text-[10px] text-muted-foreground">/</kbd>
          )}
        </div>}
        <div className="inline-flex w-fit shrink-0 gap-1 rounded-full border border-border/70 bg-card/75 p-1 shadow-sm backdrop-blur-xl" aria-label="投递记录视图">
          {([
            { id: "board" as const, label: "看板", icon: LayoutGrid },
            { id: "table" as const, label: "列表", icon: List },
          ]).map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={view === option.id}
                onClick={() => setView(option.id)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-all duration-200",
                  view === option.id ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>
        </div>
      </div>

      {term && shown.length > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground" role="status">
          找到 {shown.length} 条投递{companies > 1 ? `（${companies} 家公司）` : ""}
          {shown.length === 1 ? "，按回车直接打开" : ""}
          <button type="button" onClick={() => { setDraft(""); commit(""); }} className="ml-2 font-medium text-primary hover:underline">显示全部</button>
        </p>
      )}

      {term && shown.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-[1.6rem] border border-dashed border-border/80 bg-card/55 px-6 py-10 text-center" role="status">
          <SearchX className="size-6 text-muted-foreground" />
          <h3 className="mt-4 text-base font-semibold">没有找到和「{term}」有关的投递</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">可以试试公司简称、岗位里的关键词，或公司名的拼音首字母（字节跳动 → zjtd）。</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { setDraft(""); commit(""); inputRef.current?.focus(); }}>显示全部投递</Button>
        </div>
      ) : view === "board" ? (
        <ApplicationsBoard
          hits={hits}
          applications={shown.map((a) => ({
            id: a.id,
            companyName: a.company.name,
            title: a.title,
            currentStage: a.currentStage,
            currentStageLabel: a.currentStageLabel,
            terminatedAtStage: a.terminatedAtStage,
            terminatedAtStageLabel: a.terminatedAtStageLabel,
            appliedDate: a.appliedDate,
            currentStageDate: a.currentStageDate,
            nextDeadline: a.nextDeadline,
            nextDeadlineEnd: a.nextDeadlineEnd,
            portalStatus: a.portalStatus,
            portalSuggestedStage: a.portalSuggestedStage,
          }))}
        />
      ) : (
        <Card className="border-0 bg-card/80">
          <CardContent className="pt-1">
            <ApplicationsTable applications={shown} hits={hits} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
