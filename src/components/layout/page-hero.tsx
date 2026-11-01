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
      <div aria-hidden="true" className="page-hero-decor pointer-events-none absolute inset-0" />
      {back && <div className="relative mb-3">{back}</div>}
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {Icon && <span className="page-hero-chip hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex"><Icon className="size-5" /></span>}
          <div className="min-w-0">
            <h1 className="font-semibold">{title}</h1>
            {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </header>
  );
}
