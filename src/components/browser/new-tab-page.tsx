"use client";

import { Building2, Clock, Compass, ListChecks, Radar, Search, Sparkles } from "lucide-react";
import { displayUrl, type QuickLinks } from "@/components/browser/omnibox";
import type { DesktopBridgeHistoryEntry } from "@/types/desktop-bridge";

type Tile = { key: string; title: string; url: string; kind: string; icon: typeof Radar };

function initial(title: string) {
  const text = title.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").trim();
  return (text.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();
}

/**
 * What a blank tab shows, like a browser's new-tab page: the address box and
 * shortcut tiles for the places a job seeker keeps going back to — each
 * company's 进度页, saved JD links, 企业官网 — plus recent visits.
 */
export function NewTabPage({
  links,
  history,
  onOpen,
  onFocusAddress,
}: {
  links: QuickLinks;
  history: DesktopBridgeHistoryEntry[];
  onOpen: (url: string, inNewTab: boolean) => void;
  onFocusAddress: () => void;
}) {
  const tiles: Tile[] = [
    ...links.portals.map((p) => ({ key: `p:${p.id}`, title: p.name, url: p.url, kind: "进度页", icon: Radar })),
    ...links.positions.map((p) => ({ key: `j:${p.id}`, title: p.label, url: p.url, kind: "候选岗位", icon: ListChecks })),
    ...links.companies.map((c) => ({ key: `c:${c.id}`, title: c.name, url: c.url, kind: "企业官网", icon: Building2 })),
  ].slice(0, 10);
  const recent = history.slice(0, 5);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-card">
      <div className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-[10vh] pb-12">
        <div className="mb-6 flex items-center gap-2.5 text-[22px] font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary"><Compass className="size-5" /></span>
          网申浏览器
        </div>
        <button
          type="button"
          onClick={onFocusAddress}
          className="flex h-11 w-full max-w-xl items-center gap-3 rounded-full border bg-muted/50 px-5 text-left text-sm text-muted-foreground shadow-sm transition-colors hover:bg-muted"
        >
          <Search className="size-4" />
          输入网址，或搜索企业官网 / 岗位
        </button>
        {tiles.length > 0 && (
          <div className="mt-8 flex w-full max-w-2xl flex-wrap justify-center gap-x-2 gap-y-3">
            {tiles.map((tile) => (
              <button
                key={tile.key}
                type="button"
                title={`${tile.title}\n${tile.url}`}
                onClick={(event) => onOpen(tile.url, event.metaKey || event.ctrlKey)}
                onAuxClick={(event) => { if (event.button === 1) onOpen(tile.url, true); }}
                className="group flex w-[7.5rem] min-w-0 flex-col items-center gap-2 rounded-xl px-2 py-3 transition-colors hover:bg-muted"
              >
                <span className="relative grid size-12 place-items-center rounded-full bg-muted text-base font-semibold text-foreground/80 group-hover:bg-background">
                  {initial(tile.title)}
                  <tile.icon className="absolute -right-0.5 -bottom-0.5 size-4 rounded-full bg-card p-0.5 text-primary" />
                </span>
                <span className="w-full truncate text-center text-xs">{tile.title}</span>
                <span className="-mt-1.5 text-[10.5px] text-muted-foreground">{tile.kind}</span>
              </button>
            ))}
          </div>
        )}
        {recent.length > 0 && (
          <div className="mt-8 w-full max-w-xl">
            <p className="mb-1.5 flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground"><Clock className="size-3.5" />最近访问</p>
            <ul>
              {recent.map((entry) => (
                <li key={entry.url}>
                  <button type="button" onClick={(event) => onOpen(entry.url, event.metaKey || event.ctrlKey)} className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted">
                    <span className="min-w-0 truncate">{entry.title || displayUrl(entry.url)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{displayUrl(entry.url)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-10 flex max-w-xl items-start gap-2 text-center text-xs leading-relaxed text-muted-foreground">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
          打开企业的网申页面后，点右上角「一键填写」自动填表；右侧的填写助手可以逐字段预览、定位待手填的项目。
        </p>
      </div>
    </div>
  );
}
