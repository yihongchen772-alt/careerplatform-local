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

/** A realistic mini-desktop drawn the way each style actually renders surfaces. */
function StylePreview({ style }: { style: ThemeStyle }) {
  if (style === "soft") {
    return (
      <span className="relative block h-24 overflow-hidden rounded-xl border border-black/5 bg-gradient-to-br from-[#eef0fa] via-[#f5f6fc] to-[#eaeefb] p-2">
        <span className="absolute -right-4 -top-4 size-16 rounded-full bg-[var(--glow-1)] opacity-25 blur-xl" />
        <span className="relative flex h-full gap-2">
          <span className="w-7 space-y-1 rounded-xl bg-white/85 p-1.5 shadow-[0_4px_12px_-4px_rgba(15,23,42,0.12)] ring-1 ring-black/[0.04]">
            <span className="block h-1.5 w-4 rounded-full bg-[var(--primary)]" />
            <span className="block h-1 w-3.5 rounded-full bg-black/12" />
            <span className="block h-1 w-3 rounded-full bg-black/10" />
          </span>
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="block flex-1 rounded-xl bg-white p-2 shadow-[0_6px_16px_-6px_rgba(15,23,42,0.14)] ring-1 ring-black/[0.03]">
              <span className="block h-1.5 w-11 rounded-full bg-black/25" />
              <span className="mt-1.5 flex gap-1">
                <span className="h-3 flex-1 rounded-lg bg-[var(--primary)]/10" />
                <span className="h-3 flex-1 rounded-lg bg-amber-500/12" />
              </span>
            </span>
            <span className="block h-3 w-10 self-end rounded-full bg-[var(--primary)] shadow-xs" />
          </span>
        </span>
      </span>
    );
  }
  if (style === "glass") {
    return (
      <span className="relative block h-24 overflow-hidden rounded-xl border border-white/40 bg-[#0f172a] p-2">
        <span className="absolute -right-2 -top-4 size-18 rounded-full bg-[var(--glow-1)] opacity-75 blur-xl" />
        <span className="absolute -bottom-5 left-1 size-16 rounded-full bg-[var(--glow-2)] opacity-65 blur-xl" />
        <span className="relative flex h-full gap-2">
          <span className="w-7 space-y-1 rounded-xl border border-white/30 bg-white/18 p-1.5 backdrop-blur-md">
            <span className="block h-1.5 w-4 rounded-full bg-white/90" />
            <span className="block h-1 w-3.5 rounded-full bg-white/35" />
            <span className="block h-1 w-3 rounded-full bg-white/25" />
          </span>
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="block flex-1 rounded-xl border border-white/35 bg-white/20 p-2 shadow-lg backdrop-blur-md">
              <span className="block h-1.5 w-12 rounded-full bg-white/85" />
              <span className="mt-1.5 block h-1 w-16 rounded-full bg-white/45" />
            </span>
            <span className="block h-3 w-10 self-end rounded-full border border-white/40 bg-[var(--primary)] shadow-[0_0_12px_var(--primary)]" />
          </span>
        </span>
      </span>
    );
  }
  if (style === "classic") {
    return (
      <span className="relative block h-24 overflow-hidden rounded-xl border border-black/8 bg-[#f1f3f9] p-0">
        <span className="relative flex h-full">
          <span className="w-8 space-y-1.5 border-r border-black/8 bg-white/80 p-1.5">
            <span className="block h-2 w-full rounded-md bg-[var(--primary)] shadow-2xs" />
            <span className="block h-1 w-4 rounded-full bg-black/15" />
            <span className="block h-1 w-3.5 rounded-full bg-black/12" />
          </span>
          <span className="flex flex-1 flex-col gap-1.5 p-2">
            <span className="block h-5 rounded-lg bg-[var(--primary)] p-1.5">
              <span className="block h-1.5 w-10 rounded-full bg-white/90" />
            </span>
            <span className="block flex-1 rounded-lg border border-black/6 bg-white p-1.5 shadow-xs">
              <span className="block h-1 w-12 rounded-full bg-black/20" />
            </span>
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="relative block h-24 overflow-hidden rounded-xl border border-black/12 bg-[#fafafa] p-0">
      <span className="relative flex h-full">
        <span className="w-8 space-y-1.5 border-r border-black/12 bg-[#f5f5f5] p-1.5">
          <span className="block h-1.5 w-4 border-l-2 border-[var(--primary)] bg-black/8 pl-1" />
          <span className="block h-1 w-3.5 bg-black/15" />
          <span className="block h-1 w-3 bg-black/12" />
        </span>
        <span className="flex flex-1 flex-col justify-between p-2">
          <span className="block rounded-[3px] border border-black/12 bg-white p-1.5">
            <span className="block h-1.5 w-11 bg-black/30" />
            <span className="mt-1 block h-1 w-14 bg-black/12" />
          </span>
          <span className="block h-2.5 w-9 self-end rounded-[3px] bg-black/85" />
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
