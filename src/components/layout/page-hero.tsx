import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A page's opening: a light brand-tinted card with a gradient icon tile in the
 * 柔光 style (page-hero in globals.css), a plain heading in the others. Only
 * 总览 keeps the full gradient card, so it stays the one place that greets
 * you. One component so every page opens the same way.
 */
export function PageHero({ title, description, icon: Icon, actions, back, className, children }: { title: React.ReactNode; description?: React.ReactNode; icon?: LucideIcon; actions?: React.ReactNode; back?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <header className={cn("page-hero", className)}>
      <div aria-hidden="true" className="page-hero-decor pointer-events-none absolute inset-0">
        <span className="absolute -right-12 -top-16 size-48 rounded-full bg-primary/12 blur-2xl dark:bg-primary/20" />
        <span className="absolute right-[14%] top-4 size-8 rotate-12 rounded-xl bg-primary/10 ring-1 ring-white/40 backdrop-blur-md dark:bg-white/5 dark:ring-white/10" />
      </div>
      {back && <div className="relative mb-3">{back}</div>}
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {Icon && (
            <span className="page-hero-chip hidden size-11 shrink-0 items-center justify-center rounded-[14px] bg-primary/10 text-primary transition-transform duration-300 ease-(--ease-apple) sm:flex">
              <Icon className="size-5" strokeWidth={2} />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </header>
  );
}
