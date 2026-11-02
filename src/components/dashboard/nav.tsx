"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Database,
  FileText,
  Globe,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessageSquare,
  Search,
  Send,
  Settings,
  TrendingUp,
  Wrench,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useThemeSettings } from "@/components/theme-provider";
import { TOOL_LINKS } from "@/lib/nav-tools";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { GlobalSearchDialog } from "@/components/search/global-search-dialog";
import { BrandMark } from "@/components/brand-mark";

type NavLink = { href: string; label: string; icon: LucideIcon };

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

// Grouped by what the applicant is doing: the daily loop first, then finding
// openings, preparing, looking back. Tools used now and then sit behind 工具箱
// (/tools), so the list stays short. 设置 sits at the bottom.
const groups: { label: string | null; links: NavLink[] }[] = [
  {
    label: null,
    links: [
      { href: "/dashboard", label: "总览", icon: LayoutDashboard },
      { href: "/applications", label: "投递记录", icon: Send },
      { href: "/pool", label: "候选岗位池", icon: ListChecks },
      { href: "/calendar", label: "日历", icon: CalendarDays },
    ],
  },
  {
    label: "找岗位",
    links: [
      { href: "/leads", label: "秋招信息库", icon: Database },
      { href: "/browser", label: "网申浏览器", icon: Globe },
    ],
  },
  {
    label: "准备与复盘",
    links: [
      { href: "/mock-interview", label: "AI 模拟面试", icon: MessageSquare },
      { href: "/resumes", label: "简历版本", icon: FileText },
      { href: "/insights", label: "转化率", icon: TrendingUp },
    ],
  },
];

const toolsLink: NavLink = { href: "/tools", label: "工具箱", icon: Wrench };

const settingsLink: NavLink = { href: "/settings", label: "设置", icon: Settings };

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
  onNavigate,
  badge,
}: {
  link: NavLink;
  active: boolean;
  onNavigate?: () => void;
  badge?: { text: string; title: string } | null;
}) {
  const Icon = link.icon;
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      title={badge?.title}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[32px] items-center gap-2.5 rounded-xl px-3 text-[13px] transition-colors duration-150",
        active
          ? "nav-active font-medium"
          : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "nav-active-icon")} strokeWidth={active ? 2 : 1.7} />
      {link.label}
      {badge && <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-700 dark:text-amber-300">{badge.text}</span>}
    </Link>
  );
}

function NavContent({
  userLabel,
  onSearchClick,
  onNavigate,
}: {
  userLabel: string;
  onSearchClick: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const today = useTodaySchedule();
  const todayBadge = today.count > 0 ? { text: `今天 ${today.count}`, title: `今天的安排：\n${today.labels.join("\n")}` } : null;

  return (
    <div className="flex h-full flex-col px-3 py-4">
      <div className="flex items-center gap-2 px-2.5 text-[15px] font-semibold tracking-tight">
        <BrandMark className="size-6 shrink-0 rounded-md" />
        求职罗盘
      </div>

      <button
        type="button"
        onClick={onSearchClick}
        className="mt-3 flex h-8 w-full items-center gap-2 rounded-md bg-foreground/[0.04] px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
      >
        <Search className="size-3.5 shrink-0" />
        搜索
        <kbd className="ml-auto hidden font-sans text-[11px] text-muted-foreground/70 md:inline">⌘K</kbd>
      </button>

      <nav aria-label="主导航" className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.label ?? "main"} className="space-y-0.5">
            {group.label && <p className="px-2.5 pb-0.5 text-[11px] font-medium text-muted-foreground/60">{group.label}</p>}
            {group.links.map((link) => (
              <NavItem
                key={link.href}
                link={link}
                active={isActive(link.href)}
                onNavigate={onNavigate}
                badge={link.href === "/applications" ? todayBadge : null}
              />
            ))}
          </div>
        ))}
        <div className="space-y-0.5">
          <NavItem link={toolsLink} active={isActive(toolsLink.href) || TOOL_LINKS.some((link) => isActive(link.href))} onNavigate={onNavigate} />
        </div>
      </nav>

      <div className="mt-2 space-y-0.5 border-t border-(--sidebar-edge) pt-2">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1"><NavItem link={settingsLink} active={isActive(settingsLink.href)} onNavigate={onNavigate} /></div>
          <ThemeToggle />
        </div>
        <p className="truncate px-2.5 pt-1 text-[11px] text-muted-foreground/70">{userLabel}</p>
      </div>
    </div>
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
      className="grid size-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function DashboardNav({ userLabel }: { userLabel: string }) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <GlobalSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Desktop sidebar — sticky so the nav stays reachable on long pages
          instead of scrolling away with the content. Translucent + blurred
          rather than a flat fill, the way macOS's own sidebar material
          reads as a distinct layer floating over the content instead of a
          solid panel butted up against it. */}
      <aside className="app-sidebar hidden w-56 shrink-0 border-r border-(--sidebar-edge) bg-(--sidebar-surface) backdrop-blur-xl md:block print:hidden">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <NavContent
            userLabel={userLabel}
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
