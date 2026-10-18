"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentChat } from "./agent-chat";

const WIDTH_KEY = "careerplatform.agent.width";
const MIN_WIDTH = 380;

function readWidth() {
  try { return Number(localStorage.getItem(WIDTH_KEY)) || 460; } catch { return 460; }
}

/** 网申浏览器 opens 小欧 in its own side panel, next to the page, instead of over it. */
export function isBrowserRoute(pathname: string | null) {
  return !!pathname && (pathname === "/browser" || pathname.startsWith("/browser/"));
}

/**
 * The 小欧 button on every page: a side panel down the right edge, as tall
 * as the window, dragged wider from its left edge (the width is kept).
 */
export function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [width, setWidth] = useState(460);
  const [askText, setAskText] = useState<string | null>(null);
  const dragging = useRef(false);
  const inBrowser = isBrowserRoute(pathname);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only saved width
    setWidth(readWidth());
  }, []);

  // 「接着问小欧」 elsewhere (the 总览 brief): open with the question typed in.
  useEffect(() => {
    if (inBrowser) return;
    const ask = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      setOpen(true);
      if (typeof text === "string") setAskText(text);
    };
    window.addEventListener("xiaoou:ask", ask);
    return () => window.removeEventListener("xiaoou:ask", ask);
  }, [inBrowser]);

  function startDrag(event: React.PointerEvent) {
    event.preventDefault();
    dragging.current = true;
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const next = Math.min(Math.max(window.innerWidth - e.clientX - 16, MIN_WIDTH), Math.round(window.innerWidth * 0.75));
      setWidth(next);
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setWidth((value) => { try { localStorage.setItem(WIDTH_KEY, String(value)); } catch { /* per-viewer convenience */ } return value; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (inBrowser) return null;
  const panelWidth = wide ? "min(56rem, calc(100vw - 2rem))" : `min(${width}px, calc(100vw - 2rem))`;

  return (
    <>
      {open && (
        <div role="dialog" aria-label="小欧求职助手" style={{ width: panelWidth }} className="assistant-panel fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 top-4 z-50 flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xl">
          {!wide && <div role="separator" aria-orientation="vertical" aria-label="拖动调整宽度" title="拖动调整宽度" onPointerDown={startDrag} className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/20" />}
          <AgentChat
            askText={askText}
            onAskConsumed={() => setAskText(null)}
            onNavigate={() => setOpen(false)}
            header={(
              <div className="assistant-head flex items-center gap-1 border-b px-3 py-2">
                <div className="flex-1"><p className="text-sm font-medium">小欧</p><p className="text-[11px] text-muted-foreground">求职 agent · 规划决策 · 找岗位 · 记录进展</p></div>
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={wide ? "恢复宽度" : "放大"} onClick={() => setWide((v) => !v)}>
                  {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="关闭小欧" onClick={() => setOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
            )}
          />
        </div>
      )}

      <Button type="button" size="icon" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 size-12 rounded-full shadow-lg" aria-label={open ? "关闭小欧" : "打开小欧"} onClick={() => setOpen((v) => !v)}>
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </Button>
    </>
  );
}
