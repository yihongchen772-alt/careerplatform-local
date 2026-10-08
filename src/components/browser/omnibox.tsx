"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Clock, Globe, Info, ListChecks, Loader2, Lock, Radar, Search, Star, TriangleAlert, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { useModKey } from "@/components/browser/tab-strip";
import type { DesktopBridgeHistoryEntry } from "@/types/desktop-bridge";

export type QuickLinks = {
  /** 企业名录 entries that have a careers URL. */
  companies: { id: string; name: string; url: string }[];
  /** Candidate-pool positions with a JD link, active ones first. */
  positions: { id: string; label: string; url: string }[];
  /** Companies with a 进度同步 page set. */
  portals: { id: string; name: string; url: string }[];
};

type Suggestion = { key: string; kind: "go" | "search" | "portal" | "position" | "company" | "history"; title: string; url: string; detail?: string };

const KIND_ICON = { go: Globe, search: Search, portal: Radar, position: ListChecks, company: Building2, history: Clock } as const;
const KIND_LABEL = { go: "", search: "", portal: "进度页", position: "候选岗位", company: "企业官网", history: "最近访问" } as const;

/** "careers.example.com/apply" — the scheme only matters while editing. */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/^([^/?#]+)\/$/, "$1");
}

function looksLikeAddress(text: string) {
  return /^[a-z][\w+.-]*:\/\//i.test(text) || (!/\s/.test(text) && /\.[a-z]{2,}(?:[:/?#]|$)/i.test(text)) || /^localhost(?::\d+)?(?:\/|$)/i.test(text);
}

function SecurityIcon({ url, typing }: { url: string | null; typing: boolean }) {
  if (typing || !url) return <Search className="size-3.5 shrink-0 text-muted-foreground" />;
  if (/^https:/i.test(url)) return <span title="连接已加密"><Lock className="size-3.5 shrink-0 text-muted-foreground" /></span>;
  if (/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//i.test(url)) return <span title="本机页面"><Info className="size-3.5 shrink-0 text-muted-foreground" /></span>;
  return <span title="连接未加密：不要在这个页面填写密码等敏感信息"><TriangleAlert className="size-3.5 shrink-0 text-amber-600" /></span>;
}

/**
 * The address bar, Chrome-style: the address without its scheme until it is
 * clicked, then the full URL selected for typing over. Suggestions open
 * underneath — the saved 进度页 / 候选岗位 / 企业官网 links and recent visits —
 * so going back to a 网申 site never needs a separate launcher.
 */
export function Omnibox({
  url,
  links,
  history,
  zoomPercent,
  capturing,
  inputRef,
  onNavigate,
  onOpenChange,
  onZoomReset,
  onBookmark,
  onFocusRequestHistory,
}: {
  url: string | null;
  links: QuickLinks;
  history: DesktopBridgeHistoryEntry[];
  zoomPercent: number;
  capturing: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onNavigate: (url: string, inNewTab: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onZoomReset: () => void;
  onBookmark: () => void;
  onFocusRequestHistory: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const mod = useModKey();
  const query = (draft ?? "").trim();
  const typing = draft !== null && draft !== url;

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!focused) return [];
    const pool: Suggestion[] = [
      ...links.portals.map((p) => ({ key: `portal:${p.id}`, kind: "portal" as const, title: p.name, url: p.url })),
      ...links.positions.map((p) => ({ key: `position:${p.id}`, kind: "position" as const, title: p.label, url: p.url })),
      ...links.companies.map((c) => ({ key: `company:${c.id}`, kind: "company" as const, title: c.name, url: c.url })),
    ];
    const recent = history.map((h) => ({ key: `history:${h.url}`, kind: "history" as const, title: h.title || displayUrl(h.url), url: h.url }));
    if (!typing || !query) {
      const seen = new Set<string>();
      return [...recent.slice(0, 4), ...pool].filter((item) => !seen.has(item.url) && !!seen.add(item.url)).slice(0, 8);
    }
    const needle = query.toLowerCase();
    const matches = [...pool, ...recent]
      .map((item) => {
        const haystack = `${item.title} ${displayUrl(item.url)}`.toLowerCase();
        const at = haystack.indexOf(needle);
        return { item, rank: at < 0 ? -1 : displayUrl(item.url).toLowerCase().startsWith(needle) ? 0 : at === 0 ? 1 : 2 };
      })
      .filter(({ rank }) => rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map(({ item }) => item);
    const seen = new Set<string>();
    const first: Suggestion = looksLikeAddress(query)
      ? { key: "go", kind: "go", title: query, url: query, detail: "打开网址" }
      : { key: "search", kind: "search", title: query, url: query, detail: "用必应搜索" };
    return [first, ...matches.filter((item) => !seen.has(item.url) && !!seen.add(item.url))].slice(0, 8);
  }, [focused, typing, query, links, history]);

  const open = focused && suggestions.length > 0;
  // The page is a native layer above the App; it steps aside while the list is open.
  useEffect(() => {
    onOpenChange(open);
    return () => onOpenChange(false);
  }, [open, onOpenChange]);

  function finish() {
    setDraft(null);
    setHighlight(-1);
    inputRef.current?.blur();
  }

  function choose(item: Suggestion | null, inNewTab: boolean) {
    const target = item ? item.url : (draft ?? url ?? "").trim();
    if (!target) return;
    onNavigate(target, inNewTab);
    finish();
  }

  const value = focused ? (draft ?? url ?? "") : url ? displayUrl(url) : "";

  return (
    <div className="relative min-w-0 flex-1">
      <div
        className={cn(
          "flex h-8 items-center gap-2 rounded-full px-3 transition-[background-color,box-shadow]",
          open ? "rounded-b-none rounded-t-2xl bg-popover shadow-[0_0_0_1px_var(--border)]" : focused ? "bg-card ring-2 ring-primary/40" : "bg-muted hover:bg-foreground/[0.07] dark:bg-background"
        )}
      >
        <SecurityIcon url={url} typing={focused && typing} />
        <input
          ref={inputRef}
          value={value}
          spellCheck={false}
          aria-label="地址栏"
          aria-expanded={open}
          aria-controls="omnibox-suggestions"
          aria-activedescendant={highlight >= 0 ? `omnibox-option-${highlight}` : undefined}
          role="combobox"
          placeholder="输入网址，或搜索企业官网 / 岗位"
          onFocus={(event) => {
            setFocused(true);
            onFocusRequestHistory();
            const input = event.currentTarget;
            requestAnimationFrame(() => input.select());
          }}
          onBlur={() => {
            setFocused(false);
            setDraft(null);
            setHighlight(-1);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setHighlight(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (!suggestions.length) return;
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setHighlight((current) => {
                const next = current + step;
                return next < -1 ? suggestions.length - 1 : next >= suggestions.length ? -1 : next;
              });
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(highlight >= 0 ? suggestions[highlight] : null, event.metaKey || event.ctrlKey || event.altKey);
            } else if (event.key === "Escape") {
              event.preventDefault();
              finish();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
        {!focused && zoomPercent !== 100 && (
          <button type="button" onClick={onZoomReset} title={`网页缩放 ${zoomPercent}%，点按还原为 100%`} className="flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
            <ZoomIn className="size-3.5" />
            {zoomPercent}%
          </button>
        )}
        {!focused && url && (
          <button type="button" onClick={onBookmark} disabled={capturing} title="收藏为候选岗位：读取这页的岗位信息，存进候选岗位池" aria-label="收藏为候选岗位" className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-60">
            {capturing ? <Loader2 className="size-3.5 animate-spin" /> : <Star className="size-3.5" />}
          </button>
        )}
      </div>
      {open && (
        <div
          id="omnibox-suggestions"
          role="listbox"
          aria-label="地址建议"
          className="absolute inset-x-0 top-full z-40 overflow-hidden rounded-b-2xl bg-popover pb-2 text-popover-foreground shadow-[0_0_0_1px_var(--border),0_12px_28px_-8px_rgb(0_0_0/0.25)]"
        >
          <div className="mx-3 mb-1 h-px bg-border" />
          {suggestions.map((item, index) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <div
                key={item.key}
                id={`omnibox-option-${index}`}
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => {
                  // Keep focus in the input until the click lands.
                  event.preventDefault();
                  choose(item, event.metaKey || event.ctrlKey || event.button === 1);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={cn("flex h-9 cursor-default items-center gap-3 px-3.5 text-[13px]", index === highlight && "bg-accent text-accent-foreground")}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{item.kind === "go" ? displayUrl(item.title) : item.title}</span>
                {item.detail ? (
                  <span className="shrink-0 text-xs text-muted-foreground">— {item.detail}</span>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">— {displayUrl(item.url)}</span>
                )}
                {KIND_LABEL[item.kind] && <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground">{KIND_LABEL[item.kind]}</span>}
              </div>
            );
          })}
          <p className="px-3.5 pt-1 text-[11px] text-muted-foreground">↑↓ 选择 · 回车打开 · {mod}回车在新标签页打开</p>
        </div>
      )}
    </div>
  );
}
