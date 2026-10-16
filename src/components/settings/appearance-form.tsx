"use client";

import { Check, Laptop, Moon, Sun } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useThemeSettings } from "@/components/theme-provider";
import { PALETTES, STYLES, type ThemeMode, type ThemeStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";

const MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "system", label: "跟随系统", icon: Laptop },
];

/** A tiny window drawn the way each style draws surfaces. */
function StylePreview({ style }: { style: ThemeStyle }) {
  const card = style === "soft" ? "rounded-lg bg-white shadow-[0_4px_12px_-6px_rgba(15,23,42,0.25)]" : style === "minimal" ? "rounded-[3px] border border-black/10 bg-white" : style === "glass" ? "rounded-md border border-white/70 bg-white/55 shadow-[0_4px_10px_-6px_rgba(0,0,0,0.25)] backdrop-blur" : "rounded-md bg-white shadow-[0_3px_8px_-4px_rgba(0,0,0,0.25)]";
  const button = style === "minimal" ? "rounded-[3px] bg-[var(--primary)]" : style === "soft" ? "rounded-full bg-[var(--primary)]" : "rounded-full bg-[image:var(--gradient-accent)]";
  return (
    <span className={cn("relative block h-20 overflow-hidden rounded-lg border border-black/5 p-2", style === "minimal" ? "bg-[#fafafa]" : style === "soft" ? "bg-[#f2f3f7]" : "bg-[#f3f3f7]")}>
      {style === "glass" && <span className="absolute -right-3 -top-4 size-14 rounded-full bg-[var(--glow-1)] opacity-50 blur-xl" />}
      {style === "glass" && <span className="absolute -bottom-6 left-2 size-12 rounded-full bg-[var(--glow-2)] opacity-40 blur-xl" />}
      <span className="relative flex h-full gap-1.5">
        <span className={cn("w-6 space-y-1 p-1", style === "minimal" ? "border-r border-black/10" : style === "glass" ? "rounded-md bg-white/40" : style === "soft" ? "" : "rounded-md bg-white/70")}>
          <span className="block h-1 w-3 rounded-full bg-[var(--primary)] opacity-70" />
          <span className="block h-1 w-4 rounded-full bg-black/10" />
          <span className="block h-1 w-3 rounded-full bg-black/10" />
        </span>
        <span className="flex flex-1 flex-col gap-1.5">
          <span className={cn("block flex-1 p-1.5", card)}>
            <span className="block h-1.5 w-10 rounded-full bg-black/20" />
            <span className="mt-1 block h-1 w-14 rounded-full bg-black/10" />
          </span>
          <span className={cn("block h-2.5 w-8 self-end", button)} />
        </span>
      </span>
    </span>
  );
}

export function AppearanceForm() {
  const { mode, palette, style, setMode, setPalette, setStyle } = useThemeSettings();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">外观</CardTitle>
      </CardHeader>
      <CardContent className="space-y-7">
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">界面风格</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {STYLES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStyle(item.id)}
                aria-pressed={style === item.id}
                className={cn("rounded-xl border p-2.5 text-left transition-colors", style === item.id ? "border-primary/60 ring-1 ring-primary/30" : "border-border hover:border-foreground/25")}
              >
                <StylePreview style={item.id} />
                <span className="mt-2.5 flex items-center gap-1.5 text-sm font-medium">{item.label}{style === item.id && <Check className="size-3.5 text-primary" />}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">深浅色</p>
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted/60 p-1.5">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={mode === m.id}
                  className={cn(
                    "flex min-h-10 items-center justify-center gap-2 rounded-xl px-2 text-xs font-medium transition-all duration-200 sm:text-sm",
                    mode === m.id
                      ? "bg-card text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.08)] ring-1 ring-border/60"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">配色</p>
            <span className="text-xs text-muted-foreground">{PALETTES.length} 种</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {PALETTES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPalette(p.id)}
                aria-pressed={palette === p.id}
                className={cn(
                  "group relative overflow-hidden rounded-2xl border p-3 text-left transition-all duration-300 ease-(--ease-apple) hover:-translate-y-0.5 hover:shadow-lg",
                  palette === p.id
                    ? "border-primary/50 bg-primary/5 shadow-[0_8px_24px_-16px_var(--primary)] ring-1 ring-primary/20"
                    : "border-border/70 bg-card/70 hover:border-primary/30"
                )}
              >
                <span className="block rounded-xl border border-black/5 p-2.5 shadow-inner" style={{ backgroundColor: p.surface }}>
                  <span className="mb-2 flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-black/20" />
                    <span className="size-1.5 rounded-full bg-black/10" />
                    <span className="size-1.5 rounded-full bg-black/10" />
                  </span>
                  <span className="flex gap-2">
                    <span className="w-7 rounded-md bg-white/65 p-1.5 shadow-sm">
                      <span className="mb-1 block h-1 w-3 rounded-full" style={{ backgroundColor: p.swatch }} />
                      <span className="block h-1 w-4 rounded-full bg-black/10" />
                    </span>
                    <span className="flex-1 space-y-1 rounded-md bg-white/90 p-1.5 shadow-sm">
                      <span className="block h-1.5 w-12 rounded-full bg-black/20" />
                      <span className="block h-1 w-16 rounded-full bg-black/10" />
                      <span className="block h-1 w-10 rounded-full" style={{ backgroundColor: p.swatch, opacity: 0.55 }} />
                    </span>
                  </span>
                </span>
                <span className="mt-3 flex items-center gap-2.5">
                  <span className="size-5 shrink-0 rounded-full ring-2 ring-white/80 shadow-sm" style={{ backgroundColor: p.swatch }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{p.label}</span>
                    <span className="block text-xs text-muted-foreground">{p.description}</span>
                  </span>
                  {palette === p.id && <Check className="size-4 shrink-0 text-primary" />}
                </span>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
