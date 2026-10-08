"use client";

import { useSyncExternalStore } from "react";
import { Globe, Loader2, Maximize2, Minimize2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesktopBridgeTab } from "@/types/desktop-bridge";

const subscribeNothing = () => () => {};
/** "⌘" on a Mac, "Ctrl+" on Windows — for shortcut hints. */
export function useModKey() {
  return useSyncExternalStore(subscribeNothing, () => (/Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘" : "Ctrl+"), () => "⌘");
}

export function tabTitle(tab: DesktopBridgeTab) {
  if (!tab.url || tab.url === "about:blank") return "新标签页";
  if (tab.title) return tab.title;
  try {
    return new URL(tab.url).hostname;
  } catch {
    return tab.url;
  }
}

/**
 * Browser-style tab row: the active tab shares the toolbar's surface, the
 * others sit on the frame with a hairline between them, middle-click closes
 * and a double-click on the empty strip opens a new tab — the way Chrome
 * and Edge behave, so nothing here has to be learned.
 */
export function TabStrip({
  tabs,
  activeId,
  expanded,
  onSwitch,
  onClose,
  onNew,
  onToggleExpanded,
}: {
  tabs: DesktopBridgeTab[];
  activeId: number | null;
  expanded: boolean;
  onSwitch: (id: number) => void;
  onClose: (id: number) => void;
  onNew: () => void;
  onToggleExpanded: () => void;
}) {
  const mod = useModKey();
  return (
    <div className="flex h-10 shrink-0 items-end gap-1 pr-1.5 pl-2" onDoubleClick={(event) => { if (event.target === event.currentTarget) onNew(); }}>
      <div role="tablist" aria-label="标签页" className="flex min-w-0 flex-1 items-end overflow-x-auto [scrollbar-width:none]" onDoubleClick={(event) => { if (event.target === event.currentTarget) onNew(); }}>
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const beforeActive = tabs[index + 1]?.id === activeId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={tab.url && tab.url !== "about:blank" ? `${tabTitle(tab)}\n${tab.url}` : tabTitle(tab)}
              onClick={() => onSwitch(tab.id)}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSwitch(tab.id);
              }}
              className={cn(
                "group relative flex h-[34px] min-w-[4.75rem] max-w-[14rem] flex-1 basis-[14rem] cursor-default items-center gap-2 rounded-t-[10px] pr-1.5 pl-3 text-[12.5px] outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                active
                  ? "z-10 bg-card text-foreground shadow-[0_0_0_1px_var(--border)] [clip-path:inset(-2px_-2px_0_-2px)]"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
              )}
            >
              {tab.loading ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-label="加载中" />
              ) : tab.favicon ? (
                // A data URL fetched through the 网申 session; next/image adds nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tab.favicon} alt="" className="size-4 shrink-0 rounded-[3px] object-contain" />
              ) : (
                <Globe className="size-3.5 shrink-0 opacity-70" />
              )}
              <span className="min-w-0 flex-1 truncate">{tabTitle(tab)}</span>
              <button
                type="button"
                aria-label="关闭标签页"
                title={`关闭标签页 (${mod}W)`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
              >
                <X className="size-3" />
              </button>
              {!active && !beforeActive && index < tabs.length - 1 && (
                <span aria-hidden="true" className="absolute top-2.5 right-0 bottom-2.5 w-px bg-foreground/15 group-hover:opacity-0" />
              )}
            </div>
          );
        })}
        <button
          type="button"
          aria-label="新标签页"
          title={`新标签页 (${mod}T)`}
          onClick={onNew}
          className="mb-[5px] ml-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <button
        type="button"
        aria-label={expanded ? "退出全屏浏览" : "全屏浏览"}
        title={expanded ? "退出全屏浏览" : "全屏浏览：网页占满整个窗口"}
        onClick={onToggleExpanded}
        className="mb-[5px] grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground"
      >
        {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
    </div>
  );
}
