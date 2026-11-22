"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Check,
  Database,
  FileText,
  Globe,
  Laptop,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessageSquare,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Send,
  Settings,
  Sparkles,
  TrendingUp,
  Wrench,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useThemeSettings } from "@/components/theme-provider";
import { DENSITIES, PALETTES, STYLES, THEME_PRESETS, type ThemeMode } from "@/lib/theme";
import { TOOL_LINKS } from "@/lib/nav-tools";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/layout/command-palette";
import { BrandMark } from "@/components/brand-mark";

type NavLink = { href: string; label: string; icon: LucideIcon; chipClass: string };

type Today = { count: number; labels: string[] };

/**
 * How many 面试 / 笔试 are today, for the badge beside 投递记录. Polled: the
 * sidebar stays mounted across pages, so it would otherwise never change.
 */
function useTodaySchedule(): Today {
  const [today, setToday] = useState<Today>({ count: 0, labels: [] });
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/upcoming?days=1", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { today: number; items: { label: string; relative: string; source: string }[] };
        if (alive) setToday({ count: data.today, labels: data.items.filter((item) => item.source !== "mail").slice(0, 4).map((item) => `${item.label}（${item.relative}）`) });
      } catch {
        // Offline or starting up: keep what is shown.
      }
    }
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); window.removeEventListener("focus", load); };
  }, []);
  return today;
}

// Grouped by what the applicant is doing, with iOS/macOS System Settings
// squircle icon tints so each module has an immediate visual anchor.
const groups: { label: string | null; links: NavLink[] }[] = [
  {
    label: "今日与日程",
    links: [
      { href: "/dashboard", label: "总览", icon: LayoutDashboard, chipClass: "bg-indigo-500/12 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300" },
      { href: "/calendar", label: "日程", icon: CalendarDays, chipClass: "bg-rose-500/12 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300" },
    ],
  },
  {
    label: "找岗与网申",
    links: [
      { href: "/leads", label: "秋招信息库", icon: Database, chipClass: "bg-amber-500/12 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300" },
      { href: "/pool", label: "候选岗位池", icon: ListChecks, chipClass: "bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300" },
      { href: "/browser", label: "网申浏览器", icon: Globe, chipClass: "bg-cyan-500/12 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-300" },
      { href: "/applications", label: "投递记录", icon: Send, chipClass: "bg-sky-500/12 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300" },
    ],
  },
  {
    label: "材料与备考",
    links: [
      { href: "/resumes", label: "简历与资料", icon: FileText, chipClass: "bg-teal-500/12 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300" },
      { href: "/mock-interview", label: "AI 模拟面试", icon: MessageSquare, chipClass: "bg-violet-500/12 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300" },
      { href: "/insights", label: "转化率", icon: TrendingUp, chipClass: "bg-fuchsia-500/12 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-300" },
    ],
  },
];

const toolsLink: NavLink = { href: "/tools", label: "工具箱", icon: Wrench, chipClass: "bg-slate-500/12 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300" };

const settingsLink: NavLink = { href: "/settings", label: "设置", icon: Settings, chipClass: "bg-zinc-500/12 text-zinc-600 dark:bg-zinc-400/15 dark:text-zinc-300" };

const allLinks = [...groups.flatMap((g) => g.links), toolsLink, ...TOOL_LINKS, settingsLink];

export function currentPageLabel(pathname: string): string {
  const match = allLinks
    .filter((l) => pathname.startsWith(l.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "求职罗盘";
}

function NavItem({
  link,
  active,
  collapsed = false,
  onNavigate,
  badge,
}: {
  link: NavLink;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
  badge?: { text: string; title: string } | null;
}) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      title={badge?.title ? `${link.label} · ${badge.title}` : link.label}
      aria-label={collapsed ? link.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/nav relative flex h-9 items-center rounded-xl text-[13px] transition-all duration-200 ease-(--ease-apple)",
        collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
        active
          ? "nav-active font-semibold"
          : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground"
      )}
    >
      <span
        className={cn(
          "nav-item-chip grid size-6 shrink-0 place-items-center rounded-[7px] transition-all duration-200 ease-(--ease-apple)",
          active
            ? "bg-primary text-primary-foreground shadow-[0_2px_8px_-2px_var(--primary)]"
            : cn(link.chipClass, "group-hover/nav:scale-105")
        )}
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={active ? 2.1 : 1.8} />
      </span>
      {!collapsed && <span className="truncate">{link.label}</span>}
      {collapsed && badge && (
        <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-amber-500 ring-2 ring-card" />
      )}
      {!collapsed && badge ? (
        <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-700 dark:text-amber-300">
          {badge.text}
        </span>
      ) : !collapsed && active ? (
        <span className="ml-auto size-1.5 rounded-full bg-primary opacity-75" />
      ) : null}
    </Link>
  );
}

function NavContent({
  userLabel,
  collapsed = false,
  onToggleCollapse,
  onSearchClick,
  onNavigate,
}: {
  userLabel: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSearchClick: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const today = useTodaySchedule();
  const todayBadge = today.count > 0 ? { text: `今天 ${today.count}`, title: `今天的安排：\n${today.labels.join("\n")}` } : null;

  return (
    <div className={cn("flex h-full flex-col py-4", collapsed ? "px-2" : "px-3")}>
      <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "gap-2.5 px-2")}>
        <BrandMark className="size-7 shrink-0 rounded-[9px] shadow-xs" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold tracking-tight leading-tight">求职罗盘</div>
            <div className="truncate text-[10px] font-medium text-muted-foreground/75">JobCompass · 智能求职工作台</div>
          </div>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开侧边栏" : "收起侧边栏（为网申浏览器留出更多宽度）"}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onSearchClick}
        title="搜索投递 / 岗位 (⌘K)"
        aria-label={collapsed ? "搜索投递 / 岗位" : undefined}
        className={cn(
          "mt-3.5 flex h-9 w-full items-center rounded-xl border border-foreground/[0.06] bg-foreground/[0.035] text-[13px] text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition-all duration-200 hover:border-primary/25 hover:bg-foreground/[0.06] hover:text-foreground dark:shadow-none",
          collapsed ? "justify-center px-0" : "gap-2 px-3"
        )}
      >
        <Search className="size-3.5 shrink-0 text-primary/80" />
        {!collapsed && (
          <>
            <span>全局指挥台 / 闪记</span>
            <kbd className="ml-auto hidden rounded-md border border-foreground/10 bg-card/80 px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground/80 shadow-2xs md:inline">⌘K</kbd>
          </>
        )}
      </button>

      <nav aria-label="主导航" className="mt-4 min-h-0 flex-1 space-y-3.5 overflow-y-auto pr-0.5">
        {groups.map((group) => (
          <div key={group.label ?? "main"} className="space-y-0.5">
            {group.label && !collapsed && (
              <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/55 uppercase">
                {group.label}
              </p>
            )}
            {group.links.map((link) => (
              <NavItem
                key={link.href}
                link={link}
                collapsed={collapsed}
                active={isActive(link.href)}
                onNavigate={onNavigate}
                badge={link.href === "/applications" ? todayBadge : null}
              />
            ))}
          </div>
        ))}
        <div className="space-y-0.5 pt-0.5">
          {!collapsed && (
            <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/55 uppercase">
              更多能力
            </p>
          )}
          <NavItem link={toolsLink} collapsed={collapsed} active={isActive(toolsLink.href) || TOOL_LINKS.some((link) => isActive(link.href))} onNavigate={onNavigate} />
        </div>
      </nav>

      <div className="mt-2 space-y-1.5 border-t border-(--sidebar-edge) pt-2.5">
        <div className={cn("flex items-center", collapsed ? "flex-col gap-1" : "gap-1")}>
          <div className={collapsed ? "w-full" : "min-w-0 flex-1"}>
            <NavItem link={settingsLink} collapsed={collapsed} active={isActive(settingsLink.href)} onNavigate={onNavigate} />
          </div>
          <QuickThemeSwitcher />
          <ThemeToggle />
        </div>
        {userLabel && !collapsed && (
          <div className="flex items-center gap-2 rounded-xl bg-foreground/[0.03] px-2.5 py-1.5">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
              {userLabel.slice(0, 1).toUpperCase()}
            </span>
            <p className="truncate text-xs font-medium text-muted-foreground">{userLabel}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * iOS Control Center style quick appearance popover right in the sidebar,
 * so the user can switch style / palette / mode on any page and watch the
 * current module transform immediately.
 */
function QuickThemeSwitcher() {
  const { mode, palette, style, density, seedColor, setMode, setPalette, setStyle, setDensity, setSeedColor } = useThemeSettings();
  const modes: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "浅色", icon: Sun },
    { id: "dark", label: "深色", icon: Moon },
    { id: "system", label: "自动", icon: Laptop },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="切换主题与界面风格"
        title="切换主题与界面风格"
        className="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground outline-none"
      >
        <Palette className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="max-h-[82vh] w-80 overflow-y-auto p-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Sparkles className="size-3.5 text-primary" />
              外观与双生态主题
            </span>
            <Link href="/settings?tab=appearance" className="text-[11px] font-medium text-primary hover:underline">
              完整设置
            </Link>
          </div>

          <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1">
            {modes.map((m) => {
              const Icon = m.icon;
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "flex h-7 items-center justify-center gap-1 rounded-lg text-xs font-medium transition-all",
                    active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">一键预设（Apple / Google）</p>
            <div className="flex flex-wrap gap-1.5">
              {THEME_PRESETS.map((preset) => {
                const active = style === preset.style && palette === preset.palette;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setStyle(preset.style);
                      setPalette(preset.palette);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
                      active
                        ? "border-primary/60 bg-primary/12 text-foreground ring-1 ring-primary/20"
                        : "border-border/70 bg-card/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                    )}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: `linear-gradient(135deg, ${preset.swatch}, ${preset.swatch2})` }}
                    />
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">界面风格（6 套 · 立即生效）</p>
            <div className="grid grid-cols-2 gap-1.5">
              {STYLES.map((item) => {
                const active = style === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStyle(item.id)}
                    className={cn(
                      "flex flex-col rounded-xl border px-2.5 py-1.5 text-left transition-all",
                      active
                        ? "border-primary/60 bg-primary/10 text-foreground ring-1 ring-primary/25"
                        : "border-border/70 bg-card/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                    )}
                  >
                    <span className="flex items-center justify-between gap-1 text-xs font-semibold text-foreground">
                      <span className="truncate">{item.label}</span>
                      {active ? (
                        <Check className="size-3 shrink-0 text-primary" />
                      ) : (
                        <span className="shrink-0 text-[9px] font-normal text-muted-foreground">{item.badge}</span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{item.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-muted-foreground">主题配色（12 套 + 动态取色）</p>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/70 bg-card/80 px-2 py-0.5 text-[10px] font-medium text-foreground hover:border-primary/50">
                <span className="size-2.5 rounded-full ring-1 ring-black/15" style={{ backgroundColor: seedColor }} />
                自定义
                <input
                  type="color"
                  aria-label="自定义主色"
                  value={seedColor}
                  onChange={(e) => {
                    setSeedColor(e.target.value);
                    setPalette("custom");
                  }}
                  className="sr-only"
                />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {PALETTES.map((p) => {
                const active = palette === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPalette(p.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-left text-xs transition-all",
                      active
                        ? "border-primary/60 bg-primary/10 font-semibold text-foreground ring-1 ring-primary/25"
                        : "border-border/60 bg-card/60 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                    )}
                  >
                    <span
                      className="size-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                      style={{ background: `linear-gradient(135deg, ${p.swatch}, ${p.swatch2})` }}
                    />
                    <span className="truncate text-[11px]">{p.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">界面密度</p>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/70 p-1">
              {DENSITIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDensity(d.id)}
                  className={cn(
                    "flex h-6 items-center justify-center rounded-lg text-[11px] font-medium transition-all",
                    density === d.id ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {d.label.slice(0, 2)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Light / dark in one click; 跟随系统 and the rest are in 设置 → 外观. */
function ThemeToggle() {
  const { mode, setMode } = useThemeSettings();
  // The system setting, read in the browser; the server renders it as light.
  const systemDark = useSyncExternalStore(
    (change) => { const query = window.matchMedia("(prefers-color-scheme: dark)"); query.addEventListener("change", change); return () => query.removeEventListener("change", change); },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  const dark = mode === "dark" || (mode === "system" && systemDark);
  return (
    <button
      type="button"
      onClick={() => setMode(dark ? "light" : "dark")}
      aria-label={dark ? "切换到浅色模式" : "切换到深色模式"}
      title={dark ? "切换到浅色模式" : "切换到深色模式"}
      className="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

const SIDEBAR_STORAGE_KEY = "careerplatform.sidebar.collapsed";

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeSidebar(onStoreChange: () => void) {
  const onCustom = () => onStoreChange();
  window.addEventListener("cp:sidebar-toggle", onCustom);
  window.addEventListener("storage", onCustom);
  return () => {
    window.removeEventListener("cp:sidebar-toggle", onCustom);
    window.removeEventListener("storage", onCustom);
  };
}

export function DashboardNav({ userLabel }: { userLabel: string }) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);

  function toggleCollapse() {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "0" : "1");
    } catch {
      // Ignore storage errors.
    }
    window.dispatchEvent(new Event("cp:sidebar-toggle"));
  }

  return (
    <>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Desktop sidebar — sticky & collapsible so full-bleed tools like 网申浏览器 get extra width. */}
      <aside
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "app-sidebar hidden shrink-0 border-r border-(--sidebar-edge) bg-(--sidebar-surface) backdrop-blur-xl transition-[width] duration-200 ease-(--ease-apple) md:block print:hidden",
          collapsed ? "w-[4.5rem]" : "w-60"
        )}
      >
        <div className="sticky top-0 h-screen overflow-y-auto">
          <NavContent
            userLabel={userLabel}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapse}
            onSearchClick={() => setSearchOpen(true)}
          />
        </div>
      </aside>

      {/* Mobile top bar */}
      {/* h-14 is the bar itself; the notch inset is added as padding on top, so
          the real height is 3.5rem + inset — layout's pt must match. */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-2 border-b bg-card/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden print:hidden">
        <Button
          variant="ghost"
          size="icon"
          aria-label="打开菜单"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
        <span className="font-semibold">{currentPageLabel(pathname)}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="搜索"
          className="ml-auto"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="size-5" />
        </Button>
      </header>

      {/* Mobile drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">导航菜单</SheetTitle>
          <NavContent
            userLabel={userLabel}
            onSearchClick={() => {
              setDrawerOpen(false);
              setSearchOpen(true);
            }}
            onNavigate={() => setDrawerOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
