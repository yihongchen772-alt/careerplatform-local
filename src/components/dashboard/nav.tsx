"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Brain,
  Building2,
  CalendarDays,
  Database,
  FileText,
  FolderOpen,
  Globe,
  LayoutDashboard,
  Library,
  ListChecks,
  Menu,
  MessageSquare,
  Crosshair,
  Scale,
  Search,
  Send,
  Settings,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
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

const overview: NavLink = { href: "/dashboard", label: "总览", icon: LayoutDashboard };

const groups: { label: string; links: NavLink[] }[] = [
  {
    label: "求职工具",
    links: [
      { href: "/leads", label: "秋招信息库", icon: Database },
      { href: "/pool", label: "候选岗位池", icon: ListChecks },
      { href: "/applications", label: "投递记录", icon: Send },
      { href: "/contacts", label: "联系人", icon: Users },
      { href: "/browser", label: "网申浏览器", icon: Globe },
      { href: "/mock-interview", label: "AI 模拟面试", icon: MessageSquare },
      { href: "/resume-drill", label: "简历深挖", icon: Crosshair },
      { href: "/interviews", label: "面经库", icon: BookOpen },
      { href: "/question-banks", label: "题库", icon: Library },
      { href: "/calendar", label: "日历视图", icon: CalendarDays },
      { href: "/insights", label: "转化率", icon: TrendingUp },
      { href: "/compare", label: "Offer 对比", icon: Scale },
    ],
  },
  {
    label: "资源",
    links: [
      { href: "/companies", label: "企业名录", icon: Building2 },
      { href: "/resumes", label: "简历版本", icon: FileText },
      { href: "/library", label: "资料库", icon: FolderOpen },
    ],
  },
  {
    label: "账号",
    links: [
      { href: "/settings", label: "账号设置", icon: Settings },
      { href: "/personality", label: "性格测试", icon: Brain },
    ],
  },
];

const allLinks = [overview, ...groups.flatMap((g) => g.links)];

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
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-200 ease-(--ease-apple)",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={active ? 2.1 : 1.8} />
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
  const isActive = (href: string) => pathname.startsWith(href);
  const today = useTodaySchedule();
  const todayBadge = today.count > 0 ? { text: `今天 ${today.count}`, title: `今天的安排：\n${today.labels.join("\n")}` } : null;

  return (
    <div className="flex h-full flex-col justify-between p-4">
      <div className="space-y-6">
        <div className="flex items-center gap-2.5 px-2 text-lg font-semibold tracking-tight">
          <BrandMark
            className="size-8 shrink-0 rounded-xl shadow-[0_3px_12px_-5px_rgba(0,0,0,0.4)]"
          />
          求职罗盘
        </div>

        <button
          type="button"
          onClick={onSearchClick}
          className="flex w-full items-center gap-2.5 rounded-full border bg-background/60 px-3.5 py-2 text-sm text-muted-foreground transition-all duration-200 ease-(--ease-apple) hover:border-ring/40 hover:bg-muted hover:text-foreground"
        >
          <Search className="size-4 shrink-0" />
          搜索...
          <span className="ml-auto hidden text-xs text-muted-foreground/70 md:inline">
            ⌘/Ctrl K
          </span>
        </button>

        <nav className="space-y-1">
          <NavItem
            link={overview}
            active={isActive(overview.href)}
            onNavigate={onNavigate}
          />
        </nav>

        {groups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 text-xs font-medium text-muted-foreground/70">
              {group.label}
            </p>
            <nav className="space-y-1">
              {group.links.map((link) => (
                <NavItem
                  key={link.href}
                  link={link}
                  active={isActive(link.href)}
                  onNavigate={onNavigate}
                  badge={link.href === "/applications" ? todayBadge : null}
                />
              ))}
            </nav>
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t pt-4">
        <p className="truncate px-2 text-xs text-muted-foreground">{userLabel}</p>
      </div>
    </div>
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
      <aside className="hidden w-56 shrink-0 border-r border-border/60 bg-sidebar/80 backdrop-blur-xl md:block print:hidden">
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
