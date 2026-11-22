"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Sparkles,
  Briefcase,
  Globe,
  Calendar,
  FileText,
  Scale,
  BarChart3,
  Users,
  Compass,
  FolderOpen,
  Settings,
  ArrowRight,
  Loader2,
  CornerDownLeft,
} from "lucide-react";
import { askXiaoOu } from "@/components/dashboard/agent-brief-card";
import type { CommandSearchItem } from "@/app/api/command-search/route";
import { cn } from "@/lib/utils";

type PaletteEntry = {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  keywords?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
};

/**
 * Global Spotlight-style Command Palette (Cmd/Ctrl + K).
 * Instant fuzzy page jumping, live DB search (applications/positions/contacts/tasks),
 * quick actions, and `>` natural-language quick send to 小欧.
 */
export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
} = {}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteItems, setRemoteItems] = useState<CommandSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const closePalette = useCallback(() => {
    setQuery("");
    setRemoteItems([]);
    setActiveIndex(0);
    setSearching(false);
    if (onOpenChange) onOpenChange(false);
    else setInternalOpen(false);
  }, [onOpenChange]);

  const openPalette = useCallback(() => {
    if (onOpenChange) onOpenChange(true);
    else setInternalOpen(true);
  }, [onOpenChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) closePalette();
        else openPalette();
      } else if (e.key === "Escape" && open) {
        closePalette();
      }
    };
    const onCustomOpen = () => openPalette();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("command-palette:open", onCustomOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("command-palette:open", onCustomOpen);
    };
  }, [open, closePalette, openPalette]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  // Debounced live DB search
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed || trimmed.startsWith(">")) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/command-search?q=${encodeURIComponent(trimmed)}`);
        const json = await res.json().catch(() => null);
        if (!cancelled && json?.ok && Array.isArray(json.items)) {
          setRemoteItems(json.items);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const staticEntries = useMemo<PaletteEntry[]>(() => {
    const go = (href: string) => () => {
      closePalette();
      router.push(href);
    };
    return [
      {
        id: "act:careerops",
        group: "快捷操作",
        title: "小欧 CareerOps：批量评估候选池岗位",
        subtitle: "6 维度 S/A/B/C/D/F 评级 + 定制简历与批量预填",
        keywords: "careerops 评岗 评估 批量 小欧",
        icon: Sparkles,
        run: () => {
          closePalette();
          askXiaoOu({
            text: "用 CareerOps 6 维度批量评估我候选池里的待投递岗位，给出 S/A/B/C/D/F 评级表和批量预填按钮。",
            mode: "career_ops",
            send: true,
          });
        },
      },
      {
        id: "act:mock",
        group: "快捷操作",
        title: "和小欧开启 1 对 1 模拟面试",
        subtitle: "结合 JD 与简历逐题 STAR 深挖打分",
        keywords: "mock 模拟面试 面试官 练习 小欧",
        icon: Sparkles,
        run: () => {
          closePalette();
          askXiaoOu({
            text: "挑我最近即将到来的一场面试，开始 1 对 1 实战模拟面试，一次问我一道题。",
            mode: "mock_interview",
            send: true,
          });
        },
      },
      {
        id: "act:funnel",
        group: "快捷操作",
        title: "让小欧精确计算求职漏斗与简历转化率",
        subtitle: "按简历版本 / 行业 / 城市精确统计进面率与 Offer 率",
        keywords: "漏斗 转化率 复盘 统计",
        icon: BarChart3,
        run: () => {
          closePalette();
          askXiaoOu({ text: "帮我用精确数据算一下我的全库求职漏斗，并按简历版本和行业给出改进建议。", send: true });
        },
      },
      { id: "nav:dashboard", group: "页面导航", title: "总览仪表盘", keywords: "dashboard 首页 简报", icon: Compass, run: go("/dashboard") },
      { id: "nav:applications", group: "页面导航", title: "投递记录与看板", keywords: "applications 投递 看板 进度", icon: Briefcase, run: go("/applications") },
      { id: "nav:browser", group: "页面导航", title: "智能网申浏览器", keywords: "browser 网申 自动填充 预填", icon: Globe, run: go("/browser") },
      { id: "nav:pool", group: "页面导航", title: "候选岗位池", keywords: "pool 候选池 岗位 jd", icon: FolderOpen, run: go("/pool") },
      { id: "nav:leads", group: "页面导航", title: "秋招信息库 & 官网找岗", keywords: "leads 校招表 找岗位 发现", icon: Search, run: go("/leads") },
      { id: "nav:calendar", group: "页面导航", title: "笔面试日程与待办", keywords: "calendar 日历 日程 提醒", icon: Calendar, run: go("/calendar") },
      { id: "nav:resumes", group: "页面导航", title: "简历版本与定制", keywords: "resumes 简历 pdf 体检 定制", icon: FileText, run: go("/resumes") },
      { id: "nav:interviews", group: "页面导航", title: "面经库与复盘", keywords: "interviews 面经 复盘 笔试", icon: Briefcase, run: go("/interviews") },
      { id: "nav:compare", group: "页面导航", title: "Offer 对比与谈薪", keywords: "compare offer 薪资 对比", icon: Scale, run: go("/compare") },
      { id: "nav:insights", group: "页面导航", title: "求职数据洞察", keywords: "insights 数据 统计 图表", icon: BarChart3, run: go("/insights") },
      { id: "nav:contacts", group: "页面导航", title: "人脉与内推联系人", keywords: "contacts hr 内推 联系人", icon: Users, run: go("/contacts") },
      { id: "nav:settings", group: "页面导航", title: "设置（AI Key / 邮箱 / 外观 / 备份）", keywords: "settings 设置 主题 邮箱 key 备份", icon: Settings, run: go("/settings") },
    ];
  }, [router, closePalette]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const raw = query.trim();
    const isDirectAsk = raw.startsWith(">");
    const askPrompt = isDirectAsk ? raw.slice(1).trim() : raw;
    const out: PaletteEntry[] = [];

    if (isDirectAsk && askPrompt) {
      out.push({
        id: "ask:direct",
        group: "一句话闪记 / 直通小欧",
        title: `交给小欧：${askPrompt}`,
        subtitle: "回车立即发送给小欧执行或生成确认按钮",
        icon: Sparkles,
        run: () => {
          closePalette();
          askXiaoOu({ text: askPrompt, send: true });
        },
      });
      return out;
    }

    // Remote DB results first when searching
    if (raw) {
      for (const item of remoteItems) {
        out.push({
          id: item.id,
          group: "本地数据搜索",
          title: item.title,
          subtitle: item.subtitle,
          icon: item.kind === "contact" ? Users : item.kind === "task" ? Calendar : Briefcase,
          run: () => {
            closePalette();
            router.push(item.href);
          },
        });
      }
    }

    const q = raw.toLowerCase();
    for (const entry of staticEntries) {
      if (!q || `${entry.title} ${entry.subtitle ?? ""} ${entry.keywords ?? ""}`.toLowerCase().includes(q)) {
        out.push(entry);
      }
    }

    if (raw) {
      out.push({
        id: "ask:fallback",
        group: "交给小欧",
        title: `让小欧处理：「${raw}」`,
        subtitle: "支持联网搜索、记投递、查邮件、分析决策",
        icon: Sparkles,
        run: () => {
          closePalette();
          askXiaoOu({ text: raw, send: true });
        },
      });
    }

    return out.slice(0, 16);
  }, [query, remoteItems, staticEntries, router, closePalette]);

  const safeActiveIndex = Math.min(activeIndex, Math.max(0, entries.length - 1));

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="全局指挥台"
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/45 px-4 pt-[12vh] backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border bg-card/95 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2.5 border-b px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              setActiveIndex(0);
              if (!next.trim() || next.trim().startsWith(">")) {
                setRemoteItems([]);
                setSearching(false);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (entries.length ? (i + 1) % entries.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (entries.length ? (i - 1 + entries.length) % entries.length : 0));
              } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                entries[safeActiveIndex]?.run();
              } else if (e.key === "Escape") {
                closePalette();
              }
            }}
            placeholder="搜公司/投递/岗位/页面，或输入 > 一句话闪记交给小欧…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-1.5">
          {entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配项，试试输入 &gt; 直接问小欧</p>
          ) : (
            entries.map((entry, idx) => {
              const Icon = entry.icon;
              const showHeader = idx === 0 || entries[idx - 1].group !== entry.group;
              const selected = idx === safeActiveIndex;
              return (
                <div key={entry.id}>
                  {showHeader && (
                    <p className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground">
                      {entry.group}
                    </p>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={entry.run}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
                      selected ? "bg-primary/10 text-foreground" : "text-foreground/85 hover:bg-muted/70"
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{entry.title}</p>
                      {entry.subtitle && <p className="truncate text-xs text-muted-foreground">{entry.subtitle}</p>}
                    </div>
                    {selected ? <CornerDownLeft className="size-3.5 shrink-0 text-primary" /> : <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/40" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t bg-muted/30 px-3.5 py-1.5 text-[11px] text-muted-foreground">
          <span>↑↓ 选择 · Enter 执行 · ⌘/Ctrl+K 随时呼出</span>
          <span>输入 &gt; 直通小欧闪记</span>
        </div>
      </div>
    </div>
  );
}
