import Link from "next/link";
import { cn } from "@/lib/utils";

export type ModuleTabItem = {
  href: string;
  label: string;
  badge?: string;
};

export const MODULE_CLUSTERS = {
  jobs: [
    { href: "/leads", label: "秋招信息库" },
    { href: "/companies", label: "企业名录" },
    { href: "/pool", label: "候选岗位池" },
    { href: "/browser", label: "网申浏览器" },
  ] satisfies ModuleTabItem[],
  applications: [
    { href: "/applications", label: "投递记录" },
    { href: "/compare", label: "Offer 对比" },
    { href: "/insights", label: "投递转化率" },
  ] satisfies ModuleTabItem[],
  prep: [
    { href: "/mock-interview", label: "AI 模拟面试" },
    { href: "/resume-drill", label: "简历深挖" },
    { href: "/interviews", label: "面经库" },
    { href: "/question-banks", label: "题库" },
  ] satisfies ModuleTabItem[],
  materials: [
    { href: "/resumes", label: "简历版本" },
    { href: "/library", label: "资料库（证书/作品集）" },
    { href: "/settings?tab=autofill", label: "网申资料与待核对" },
    { href: "/settings?tab=memory", label: "经历与问答记忆" },
  ] satisfies ModuleTabItem[],
};

/**
 * Contextual pill navigation placed under PageHero to link closely related
 * lifecycle modules together without cluttering the primary sidebar.
 */
export function ModuleTabs({
  items,
  activeHref,
  className,
}: {
  items: ModuleTabItem[];
  activeHref: string;
  className?: string;
}) {
  return (
    <nav
      aria-label="相关模块切换"
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-1 rounded-2xl bg-muted/65 p-1 ring-1 ring-foreground/[0.05] dark:bg-white/[0.04]",
        className
      )}
    >
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all duration-200 ease-(--ease-apple)",
              active
                ? "bg-card text-foreground shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] dark:ring-white/[0.08]"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span>{item.label}</span>
            {item.badge && (
              <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] leading-none text-primary">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
