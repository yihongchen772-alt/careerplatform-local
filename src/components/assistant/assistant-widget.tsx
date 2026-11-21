"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentChat, DEFAULT_QUICK_QUESTIONS, DEFAULT_SUGGESTIONS } from "./agent-chat";

const WIDTH_KEY = "careerplatform.agent.width";
const MIN_WIDTH = 380;

function readWidth() {
  try { return Number(localStorage.getItem(WIDTH_KEY)) || 460; } catch { return 460; }
}

/** 网申浏览器 opens 小欧 in its own side panel, next to the page, instead of over it. */
export function isBrowserRoute(pathname: string | null) {
  return !!pathname && (pathname === "/browser" || pathname.startsWith("/browser/"));
}

function routePrompts(pathname: string | null): { quickQuestions: string[]; suggestions: string[]; subtitle: string } {
  if (!pathname) return { quickQuestions: DEFAULT_QUICK_QUESTIONS, suggestions: DEFAULT_SUGGESTIONS, subtitle: "求职 agent · 规划决策 · 找岗位 · 记录进展" };
  if (/^\/applications\/[^/]+/.test(pathname)) {
    return {
      subtitle: "正在看当前投递详情 · 可直接问面经/跟进/更新阶段",
      quickQuestions: ["帮我准备这家下一轮面试", "这条投递该怎么跟进？", "帮我整理刚才的面经记下来", "查查这家公司近期校招风评"],
      suggestions: [
        "结合我的简历和这条投递的 JD，出一份针对性面试准备清单",
        "这条投递已经卡了好几天，帮我起草一封得体的 HR 跟进邮件",
        "我刚面完这一轮，帮我把面经复盘整理并保存进去",
      ],
    };
  }
  if (pathname.startsWith("/applications")) {
    return {
      subtitle: "正在看投递记录 · 筛选复盘 · 催进度 · 补城市",
      quickQuestions: ["哪些投递久未更新该催了？", "帮我盘点所有进过面试的投递", "帮我补全没写城市的投递", "对比一下我手上的进展"],
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }
  if (pathname.startsWith("/pool")) {
    return {
      subtitle: "正在看候选岗位池 · 排投递优先级 · 找新岗位",
      quickQuestions: ["候选池里最值得先投哪几个？", "哪些岗位快截止了？", "帮我按意向去官网找新岗位", "帮我准备投递匹配度最高的那个"],
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }
  if (pathname.startsWith("/calendar")) {
    return {
      subtitle: "正在看日程日历 · 排期防冲突 · 备考规划",
      quickQuestions: ["接下来一周有哪些笔面试？", "帮我排这周的备考时间表", "有没有时间冲突的安排？"],
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }
  if (pathname.startsWith("/resumes")) {
    return {
      subtitle: "正在看简历库 · 简历诊断 · 经历深挖",
      quickQuestions: ["帮我诊断默认简历的最大短板", "我的项目经历面试官会怎么深挖？", "帮我提炼一段 1 分钟自我介绍"],
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }
  if (pathname.startsWith("/compare")) {
    return {
      subtitle: "正在看 Offer 对比 · 薪资成长权衡 · 谈薪策略",
      quickQuestions: ["帮我用表格对比手上的 Offer", "从长期成长和薪资给个最终建议", "帮我拟一段得体的谈薪话术"],
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }
  if (pathname.startsWith("/leads")) {
    return {
      subtitle: "正在看秋招信息库 · 筛选高匹配线索",
      quickQuestions: ["信息库里最适合我的是哪几条？", "有哪些快截止的高匹配线索？", "帮我把最匹配的几条提进候选池"],
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }
  return { quickQuestions: DEFAULT_QUICK_QUESTIONS, suggestions: DEFAULT_SUGGESTIONS, subtitle: "求职 agent · 规划决策 · 找岗位 · 记录进展" };
}

/**
 * The 小欧 button on every page: a side panel down the right edge, as tall
 * as the window, dragged wider from its left edge (the width is kept).
 */
export function AssistantWidget() {
  const pathname = usePathname();
  const [open, setOpenState] = useState(false);
  // Mounted from the first open on and only hidden after: closing the panel
  // while 小欧 is still working must not throw that turn away.
  const [mounted, setMounted] = useState(false);
  // A reply that came in while the panel was closed: a dot on the button.
  const [unread, setUnread] = useState(false);
  const setOpen = (next: boolean | ((value: boolean) => boolean)) => {
    const result = typeof next === "function" ? next(openRef.current) : next;
    if (result) { setMounted(true); setUnread(false); }
    setOpenState(result);
  };
  const [wide, setWide] = useState(false);
  const [width, setWidth] = useState(460);
  const [askText, setAskText] = useState<string | null>(null);
  const [askSend, setAskSend] = useState(false);
  const dragging = useRef(false);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  const inBrowser = isBrowserRoute(pathname);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only saved width
    setWidth(readWidth());
  }, []);

  // Global keyboard shortcuts: Cmd/Ctrl+J toggles 小欧, Esc closes when open.
  useEffect(() => {
    if (inBrowser) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((v) => !v);
      } else if (event.key === "Escape" && openRef.current) {
        const active = document.activeElement;
        if (active && active.closest("[data-slot='dialog-content'], [data-slot='alert-dialog-content']")) return;
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inBrowser]);

  // 「接着问小欧」 elsewhere (the 总览 brief): open with the question typed in;
  // { text, send: true } (「让小欧查」 on the 投递 page) sends it straight away.
  useEffect(() => {
    if (inBrowser) return;
    const ask = (event: Event) => {
      const detail = (event as CustomEvent<string | { text?: unknown; send?: unknown }>).detail;
      setOpen(true);
      if (typeof detail === "string") {
        setAskText(detail);
        setAskSend(false);
      } else if (detail && typeof detail.text === "string") {
        setAskText(detail.text);
        setAskSend(detail.send === true);
      }
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
  const prompts = routePrompts(pathname);

  return (
    <>
      {mounted && (
        <div role="dialog" aria-label="小欧求职助手" aria-hidden={!open} style={{ width: panelWidth }} className="assistant-panel fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 top-4 z-50 flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xl data-[closed=true]:hidden" data-closed={!open}>
          {!wide && <div role="separator" aria-orientation="vertical" aria-label="拖动调整宽度" title="拖动调整宽度" onPointerDown={startDrag} className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize hover:bg-primary/20" />}
          <AgentChat
            askText={askText}
            askSend={askSend}
            routeContext={pathname ? { pathname } : undefined}
            quickQuestions={prompts.quickQuestions}
            suggestions={prompts.suggestions}
            onAskConsumed={() => { setAskText(null); setAskSend(false); }}
            onNavigate={() => setOpen(false)}
            onReply={() => { if (!openRef.current) setUnread(true); }}
            header={(
              <div className="assistant-head flex items-center gap-1 border-b px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">小欧</p>
                  <p className="truncate text-xs text-muted-foreground">{prompts.subtitle}</p>
                </div>
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

      <Button type="button" size="icon" title="打开 / 收起小欧 (⌘J / Ctrl+J)" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 size-12 rounded-full shadow-lg" aria-label={open ? "关闭小欧" : "打开小欧"} onClick={() => setOpen((v) => !v)}>
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
        {unread && !open && <span aria-label="小欧回复了" className="absolute right-0.5 top-0.5 size-3 rounded-full border-2 border-background bg-rose-500" />}
      </Button>
    </>
  );
}
