import Link from "next/link";
import { ArrowUpRight, Wrench } from "lucide-react";
import { PageHero } from "@/components/layout/page-hero";
import { TOOL_LINKS } from "@/lib/nav-tools";

const TOOL_CHIPS = [
  "bg-indigo-500/12 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300",
  "bg-sky-500/12 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
  "bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
  "bg-amber-500/12 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
  "bg-violet-500/12 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
  "bg-rose-500/12 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300",
  "bg-teal-500/12 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300",
  "bg-cyan-500/12 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-300",
];

/** 工具箱: the pages used now and then, out of the sidebar but one click away. */
export default function ToolsPage() {
  return (
    <div className="space-y-6">
      <PageHero title="工具箱" icon={Wrench} description="简历定制、面经题库、薪资对比与求职手记等深度工具都在这里" />
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {TOOL_LINKS.map(({ href, label, icon: Icon, description }, idx) => (
          <Link
            key={href}
            href={href}
            className="surface-card group flex items-start gap-3.5 rounded-2xl p-4.5 transition-all duration-300 ease-(--ease-apple) hover:-translate-y-0.5 hover:ring-1 hover:ring-primary/30"
          >
            <span className={`grid size-11 shrink-0 place-items-center rounded-[13px] transition-transform duration-300 ease-(--ease-apple) group-hover:scale-105 ${TOOL_CHIPS[idx % TOOL_CHIPS.length]}`}>
              <Icon className="size-5" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold tracking-tight">{label}</span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
