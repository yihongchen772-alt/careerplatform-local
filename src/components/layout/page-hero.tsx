import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A page's opening: a gradient card with an icon tile in the 柔光 style
 * (hero-card in globals.css), a plain heading in the others. One component so
 * every page opens the same way.
 */
export function PageHero({ title, description, icon: Icon, actions, back, className, children }: { title: React.ReactNode; description?: React.ReactNode; icon?: LucideIcon; actions?: React.ReactNode; back?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <header className={cn("hero-card page-hero", className)}>
      <div aria-hidden="true" className="hero-decor pointer-events-none absolute inset-0">
        <span className="absolute -right-10 -top-16 size-48 rounded-full bg-white/15 blur-2xl" />
        <span className="absolute right-[22%] -bottom-6 size-20 rotate-12 rounded-[1.6rem] bg-gradient-to-br from-white/30 to-white/5" />
        <span className="absolute right-[34%] top-5 size-3 rounded-full bg-amber-200/80" />
      </div>
      {back && <div className="relative mb-3">{back}</div>}
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {Icon && <span className="hero-chip hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex"><Icon className="size-5" /></span>}
          <div className="min-w-0">
            <h1 className="font-semibold">{title}</h1>
            {description && <p className="hero-sub mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </header>
  );
}
