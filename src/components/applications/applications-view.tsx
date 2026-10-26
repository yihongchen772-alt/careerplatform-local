"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, FilterX, Layers, LayoutGrid, List, MapPin, Search, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { matchApplication, type ApplicationHits } from "@/lib/application-search";
import { APPLICATION_FILTERS, FILTER_HINTS, FILTER_LABELS, filterCounts, matchesFilter, parseFilter, type ApplicationFilter } from "@/lib/application-filters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GROUP_KINDS, GROUP_LABELS, TIME_LABELS, TIME_WINDOWS, groupApplications, inTimeWindow, monthLabel, monthsPresent, parseTime, type GroupKind } from "@/lib/application-groups";
import { NO_CITY } from "@/lib/application-city";
import { useStoredChoice } from "@/components/applications/use-stored-choice";
import {
  ApplicationsTable,
  type ApplicationRow,
} from "@/components/applications/applications-table";
import { ApplicationsBoard, type BoardApplication } from "@/components/applications/applications-board";
import { PortalReviewBanner } from "@/components/applications/portal-review-banner";
import { useNow } from "@/components/schedule/use-now";

/**
 * Board and table over the same data. The board answers "where am I stuck",
 * the table answers "what did I apply to and when" — both are worth having,
 * and neither replaces the other, so this is a toggle rather than a
 * migration away from the table.
 */
const VIEWS = ["board", "table"] as const;

function timeLabel(time: string): string {
  return (TIME_LABELS as Record<string, string>)[time] ?? monthLabel(time);
}

function toBoard(a: ApplicationRow): BoardApplication {
  return {
    id: a.id,
    companyName: a.company.name,
    title: a.title,
    currentStage: a.currentStage,
    currentStageLabel: a.currentStageLabel,
    terminatedAtStage: a.terminatedAtStage,
    terminatedAtStageLabel: a.terminatedAtStageLabel,
    appliedDate: a.appliedDate,
    currentStageDate: a.currentStageDate,
    cities: a.cities,
    waiting: a.waiting,
    nextSchedule: a.nextSchedule,
    step: a.step,
    portalStatus: a.portalStatus,
    portalSuggestedStage: a.portalSuggestedStage,
  };
}

export function ApplicationsView({ applications, now: serverNow }: { applications: ApplicationRow[]; now: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const now = useNow(serverNow);
  const [view, setView] = useStoredChoice("careerplatform.applications.view", VIEWS, "board");
  // What the box shows, and what the lists are filtered by. They differ only
  // while a Chinese input method is composing, whose pinyin letters would
  // otherwise flash through the filter.
  const urlQuery = searchParams.get("q") ?? "";
  const urlFilter = parseFilter(searchParams.get("f"));
  const urlCity = searchParams.get("c") ?? "";
  const urlTime = parseTime(searchParams.get("t"));
  const [draft, setDraft] = useState(urlQuery);
  const [query, setQuery] = useState(urlQuery);
  const [filter, setFilterState] = useState<ApplicationFilter>(urlFilter);
  const [city, setCityState] = useState(urlCity);
  const [time, setTimeState] = useState(urlTime);
  // How the lists are laid out: kept on this device, like 看板 / 列表.
  const [groupBy, setGroupBy] = useStoredChoice<GroupKind>("careerplatform.applications.group", GROUP_KINDS, "none");
  const urlKey = `${urlQuery}|${urlFilter}|${urlCity}|${urlTime}`;
  const [seenUrl, setSeenUrl] = useState(urlKey);
  // Opened again with another ?q= / ?f= (from ⌘K search, say) while already here.
  if (urlKey !== seenUrl) {
    setSeenUrl(urlKey);
    if (urlCity !== city) setCityState(urlCity);
    if (urlTime !== time) setTimeState(urlTime);
    if (urlQuery !== query.trim()) {
      setDraft(urlQuery);
      setQuery(urlQuery);
    }
    if (urlFilter !== filter) setFilterState(urlFilter);
  }
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // In the address too, so coming back from a 投递 shows the same results.
  function writeUrl(change: { q?: string; f?: ApplicationFilter; c?: string; t?: string }) {
    const params = new URLSearchParams(window.location.search);
    if (change.q !== undefined) {
      if (change.q.trim()) params.set("q", change.q.trim());
      else params.delete("q");
    }
    if (change.f !== undefined) {
      if (change.f !== "all") params.set("f", change.f);
      else params.delete("f");
    }
    if (change.c !== undefined) {
      if (change.c) params.set("c", change.c);
      else params.delete("c");
    }
    if (change.t !== undefined) {
      if (change.t !== "all") params.set("t", change.t);
      else params.delete("t");
    }
    const search = params.toString();
    window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
  }

  function commit(value: string) {
    setQuery(value);
    writeUrl({ q: value });
  }

  function chooseFilter(next: ApplicationFilter) {
    const value = next === filter ? "all" : next;
    setFilterState(value);
    writeUrl({ f: value });
  }

  function chooseCity(next: string) {
    setCityState(next);
    writeUrl({ c: next });
  }

  function chooseTime(next: string) {
    setTimeState(next);
    writeUrl({ t: next });
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
  const searched = hits ? applications.filter((app) => hits.has(app.id)) : applications;
  const timed = time === "all" ? searched : searched.filter((app) => inTimeWindow(app.appliedDate, time, now));
  const inCity = (app: ApplicationRow) => !city || (city === NO_CITY ? app.cities.length === 0 : app.cities.includes(city));
  const scoped = city ? timed.filter(inCity) : timed;
  const counts = filterCounts(scoped, now);
  const shown = filter === "all" ? scoped : scoped.filter((app) => matchesFilter(app, filter, now));
  const companies = new Set(shown.map((app) => app.company.name)).size;
  const narrowed = !!term || filter !== "all" || !!city || time !== "all";
  const orderLabel = [filter !== "all" ? FILTER_LABELS[filter] : "", city ? `城市 ${city}` : "", time !== "all" ? timeLabel(time) : "", term ? `搜索「${term}」` : ""].filter(Boolean).join(" · ");

  // Cities to pick from, counted over what the other filters already leave.
  const cityOptions = useMemo(() => {
    const base = timed.filter((app) => filter === "all" || matchesFilter(app, filter, now));
    const found = new Map<string, number>();
    let none = 0;
    for (const app of base) {
      if (!app.cities.length) none += 1;
      for (const name of app.cities) found.set(name, (found.get(name) ?? 0) + 1);
    }
    if (city && city !== NO_CITY && !found.has(city)) found.set(city, 0);
    const list = [...found].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN")).map(([name, count]) => ({ name, count }));
    if (none || city === NO_CITY) list.push({ name: NO_CITY, count: none });
    return list;
  }, [timed, filter, now, city]);
  const months = useMemo(() => monthsPresent(applications.map((app) => app.appliedDate)), [applications]);
  const sections = useMemo(
    () => (groupBy === "none" ? null : groupApplications(shown, groupBy, now, (app) => app.company.name)),
    [shown, groupBy, now],
  );

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

  const chips = APPLICATION_FILTERS.filter((key) => key === "all" || key === filter || counts[key] > 0);

  function clearAll() {
    setDraft("");
    commit("");
    setFilterState("all");
    setCityState("");
    setTimeState("all");
    writeUrl({ q: "", f: "all", c: "", t: "all" });
  }

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

      {applications.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="快捷筛选">
          {chips.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              title={FILTER_HINTS[key]}
              onClick={() => chooseFilter(key)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors",
                filter === key ? "border-foreground bg-foreground text-background" : "border-border/70 bg-card/70 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              )}
            >
              {FILTER_LABELS[key]}
              <span className={cn("tabular-nums", filter === key ? "text-background/75" : "text-muted-foreground/80")}>{counts[key]}</span>
            </button>
          ))}
        </div>
      )}

      {applications.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="分组与筛选">
          <Select value={groupBy} onValueChange={(value) => value && setGroupBy(value as GroupKind)}>
            <SelectTrigger className="h-8 w-36 rounded-full text-xs" aria-label="分组方式">
              <Layers className="size-3.5 text-muted-foreground" />
              <SelectValue>{(value: string) => GROUP_LABELS[value as GroupKind] ?? "不分组"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {GROUP_KINDS.map((kind) => <SelectItem key={kind} value={kind}>{GROUP_LABELS[kind]}</SelectItem>)}
            </SelectContent>
          </Select>
          {cityOptions.length > 0 && (
            <Select value={city || "all"} onValueChange={(value) => chooseCity(!value || value === "all" ? "" : value)}>
              <SelectTrigger className="h-8 w-36 rounded-full text-xs" aria-label="按城市筛选">
                <MapPin className="size-3.5 text-muted-foreground" />
                <SelectValue>{(value: string) => (value === "all" ? "全部城市" : value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部城市</SelectItem>
                {cityOptions.map((option) => <SelectItem key={option.name} value={option.name}>{option.name} · {option.count}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={time} onValueChange={(value) => chooseTime(value ?? "all")}>
            <SelectTrigger className="h-8 w-36 rounded-full text-xs" aria-label="按投递时间筛选">
              <CalendarDays className="size-3.5 text-muted-foreground" />
              <SelectValue>{(value: string) => timeLabel(value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TIME_WINDOWS.map((win) => <SelectItem key={win} value={win}>{TIME_LABELS[win]}</SelectItem>)}
              {months.length > 1 && months.map((month) => <SelectItem key={month} value={month}>{monthLabel(month)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {narrowed && shown.length > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground" role="status">
          {orderLabel}：{shown.length} 条投递{companies > 1 ? `（${companies} 家公司）` : ""}
          {term && shown.length === 1 ? "，按回车直接打开" : ""}
          <button type="button" onClick={clearAll} className="ml-2 font-medium text-primary hover:underline">显示全部</button>
        </p>
      )}

      {narrowed && shown.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/55 px-6 py-10 text-center" role="status">
          {term ? <SearchX className="size-6 text-muted-foreground" /> : <FilterX className="size-6 text-muted-foreground" />}
          <h3 className="mt-4 text-base font-semibold">
            {term ? `没有找到和「${term}」有关的${filter !== "all" ? `「${FILTER_LABELS[filter]}」` : ""}投递` : `暂时没有符合「${orderLabel}」的投递`}
          </h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {term ? "可以试试公司简称、岗位里的关键词，或公司名的拼音首字母（字节跳动 → zjtd）。" : filter !== "all" && !city && time === "all" ? FILTER_HINTS[filter] : "换一个城市或时间范围试试，或者点下面显示全部。"}
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { clearAll(); inputRef.current?.focus(); }}>显示全部投递</Button>
        </div>
      ) : view === "board" ? (
        <ApplicationsBoard
          hits={hits}
          narrowed={narrowed}
          now={now}
          orderLabel={orderLabel}
          applications={shown.map(toBoard)}
          sections={sections?.map((section) => ({ ...section, items: section.items.map(toBoard) }))}
        />
      ) : (
        <Card className="border-0 bg-card/80">
          <CardContent className="pt-1">
            <ApplicationsTable applications={shown} hits={hits} now={now} orderLabel={orderLabel} groupBy={groupBy} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
