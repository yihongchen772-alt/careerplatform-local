"use client";

import { useSyncExternalStore } from "react";
import { Check, Laptop, Moon, Pipette, Sparkles, Sun } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useThemeSettings } from "@/components/theme-provider";
import {
  CUSTOM_SEED_SWATCHES,
  DENSITIES,
  PALETTES,
  STYLES,
  THEME_PRESETS,
  type ThemeMode,
  type ThemePalette,
  type ThemeStyle,
} from "@/lib/theme";
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
                <span className="h-3 flex-1 rounded-lg bg-[var(--primary)]/12" />
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
        <span className="absolute -right-2 -top-4 size-18 rounded-full bg-[var(--glow-1)] opacity-80 blur-xl" />
        <span className="absolute -bottom-5 left-1 size-16 rounded-full bg-[var(--glow-2)] opacity-70 blur-xl" />
        <span className="relative flex h-full gap-2">
          <span className="w-7 space-y-1 rounded-xl border border-white/35 bg-white/18 p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-md">
            <span className="block h-1.5 w-4 rounded-full bg-white/95" />
            <span className="block h-1 w-3.5 rounded-full bg-white/35" />
            <span className="block h-1 w-3 rounded-full bg-white/25" />
          </span>
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="block flex-1 rounded-xl border border-white/40 bg-white/20 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_8px_16px_rgba(0,0,0,0.3)] backdrop-blur-md">
              <span className="block h-1.5 w-12 rounded-full bg-white/90" />
              <span className="mt-1.5 block h-1 w-16 rounded-full bg-white/45" />
            </span>
            <span className="block h-3 w-10 self-end rounded-full border border-white/50 bg-[var(--primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_0_12px_var(--primary)]" />
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
  if (style === "material") {
    // Authentic Android Material You (M3): tonal containers, 28dp rounding, pill nav, solid pill FAB
    return (
      <span className="relative block h-24 overflow-hidden rounded-xl border border-black/6 bg-[#f5effa] p-0">
        <span className="relative flex h-full">
          <span className="w-8 space-y-1.5 bg-[#ece4f4] p-1.5">
            <span className="block h-2.5 w-full rounded-full bg-[var(--primary)]/25 p-0.5">
              <span className="block h-full w-3 rounded-full bg-[var(--primary)]" />
            </span>
            <span className="block h-1 w-4 rounded-full bg-black/15" />
            <span className="block h-1 w-3.5 rounded-full bg-black/12" />
          </span>
          <span className="flex flex-1 flex-col gap-1.5 p-2">
            <span className="block flex-1 rounded-2xl bg-[#fbf8fe] p-2 ring-1 ring-[var(--primary)]/12">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-lg bg-[var(--primary)]/20" />
                <span className="h-1.5 w-11 rounded-full bg-black/25" />
              </span>
              <span className="mt-1.5 flex gap-1">
                <span className="h-2.5 flex-1 rounded-full bg-[var(--primary)]/15" />
                <span className="h-2.5 flex-1 rounded-full bg-black/6" />
              </span>
            </span>
            <span className="flex items-center justify-end gap-1">
              <span className="h-2.5 w-7 rounded-full border border-black/15" />
              <span className="h-3 w-9 rounded-full bg-[var(--primary)]" />
            </span>
          </span>
        </span>
      </span>
    );
  }
  if (style === "pixel") {
    // Authentic Google Workspace (Gmail / Drive): right-rounded half-pill sidebar + airy crisp white card
    return (
      <span className="relative block h-24 overflow-hidden rounded-xl border border-black/8 bg-[#f0f4f9] p-0">
        <span className="relative flex h-full">
          <span className="w-8 space-y-1.5 py-2 pr-1">
            <span className="block h-2.5 w-full rounded-r-full bg-[#d3e3fd] pl-1.5 pt-0.5">
              <span className="block h-1 w-3 rounded-full bg-[var(--primary)]" />
            </span>
            <span className="ml-1.5 block h-1 w-4 rounded-full bg-black/15" />
            <span className="ml-1.5 block h-1 w-3.5 rounded-full bg-black/12" />
          </span>
          <span className="flex flex-1 flex-col gap-1.5 p-2">
            <span className="block h-3.5 rounded-full bg-white px-2 pt-1 shadow-[0_1px_2px_rgba(60,64,67,0.12)]">
              <span className="block h-1 w-10 rounded-full bg-black/15" />
            </span>
            <span className="block flex-1 rounded-xl border border-black/8 bg-white p-1.5">
              <span className="block h-1.5 w-11 rounded-full bg-black/22" />
              <span className="mt-1.5 block h-1 w-16 rounded-full bg-black/10" />
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

function PaletteCard({
  p,
  active,
  isDark,
  onSelect,
}: {
  p: (typeof PALETTES)[number];
  active: boolean;
  isDark: boolean;
  onSelect: (id: ThemePalette) => void;
}) {
  const bgSurface = isDark ? p.darkSurface : p.surface;
  return (
    <button
      type="button"
      onClick={() => onSelect(p.id)}
      aria-pressed={active}
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-3 text-left transition-all duration-300 ease-(--ease-apple) hover:-translate-y-0.5 hover:shadow-lg",
        active
          ? "border-primary/50 bg-primary/5 shadow-[0_8px_24px_-16px_var(--primary)] ring-1 ring-primary/20"
          : "border-border/70 bg-card/70 hover:border-primary/30"
      )}
    >
      <span
        className={cn("block rounded-xl border p-2.5 shadow-inner", isDark ? "border-white/10" : "border-black/5")}
        style={{ backgroundColor: bgSurface }}
      >
        <span className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", isDark ? "bg-white/25" : "bg-black/20")} />
            <span className={cn("size-1.5 rounded-full", isDark ? "bg-white/15" : "bg-black/10")} />
            <span className={cn("size-1.5 rounded-full", isDark ? "bg-white/15" : "bg-black/10")} />
          </span>
          <span className="h-1.5 w-6 rounded-full" style={{ background: `linear-gradient(90deg, ${p.swatch}, ${p.swatch2})` }} />
        </span>
        <span className="flex gap-2">
          <span className={cn("w-7 rounded-md p-1.5 shadow-sm", isDark ? "bg-white/8" : "bg-white/70")}>
            <span className="mb-1 block h-1 w-3 rounded-full" style={{ backgroundColor: p.swatch2 }} />
            <span className={cn("block h-1 w-4 rounded-full", isDark ? "bg-white/15" : "bg-black/10")} />
          </span>
          <span className={cn("flex-1 space-y-1 rounded-md p-1.5 shadow-sm", isDark ? "bg-white/10" : "bg-white/92")}>
            <span className={cn("block h-1.5 w-12 rounded-full", isDark ? "bg-white/30" : "bg-black/20")} />
            <span className={cn("block h-1 w-16 rounded-full", isDark ? "bg-white/15" : "bg-black/10")} />
            <span className="block h-1 w-10 rounded-full" style={{ backgroundColor: p.swatch2, opacity: 0.85 }} />
          </span>
        </span>
      </span>
      <span className="mt-3 flex items-center gap-2.5">
        <span
          className="size-5 shrink-0 rounded-full ring-2 ring-white/80 shadow-sm dark:ring-white/25"
          style={{ background: `linear-gradient(135deg, ${p.swatch} 0%, ${p.swatch2} 100%)` }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{p.label}</span>
          <span className="block truncate text-xs text-muted-foreground">{p.description}</span>
        </span>
        {active && <Check className="size-4 shrink-0 text-primary" />}
      </span>
    </button>
  );
}

export function AppearanceForm() {
  const { mode, palette, style, density, seedColor, setMode, setPalette, setStyle, setDensity, setSeedColor } = useThemeSettings();
  const systemDark = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false
  );
  const isDark = mode === "dark" || (mode === "system" && systemDark);
  const applePalettes = PALETTES.filter((p) => p.ecosystem === "apple");
  const googlePalettes = PALETTES.filter((p) => p.ecosystem === "google");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">外观与双生态风格</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* 一键氛围预设 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              一键氛围搭配（Apple iOS &amp; Google Android）
            </p>
            <span className="text-xs text-muted-foreground">点击同时切换风格与配色</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition-all duration-200 ease-(--ease-apple) hover:-translate-y-0.5",
                    active
                      ? "border-primary/60 bg-primary/8 ring-1 ring-primary/25"
                      : "border-border/80 bg-card/70 hover:border-foreground/25"
                  )}
                >
                  <span
                    className="size-7 shrink-0 rounded-full ring-2 ring-white/80 shadow-sm"
                    style={{ background: `linear-gradient(135deg, ${preset.swatch}, ${preset.swatch2})` }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <span className="truncate">{preset.label}</span>
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {preset.tag}
                      </span>
                    </span>
                  </span>
                  {active && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* 6 大界面风格 */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">界面风格</p>
            <span className="text-xs text-muted-foreground">{STYLES.length} 套 · Apple + Google 全涵盖</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {STYLES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStyle(item.id)}
                aria-pressed={style === item.id}
                className={cn(
                  "rounded-2xl border p-2.5 text-left transition-all duration-200",
                  style === item.id
                    ? "border-primary/60 bg-primary/[0.03] ring-1 ring-primary/30"
                    : "border-border hover:border-foreground/25"
                )}
              >
                <StylePreview style={item.id} />
                <span className="mt-2.5 flex items-center justify-between gap-1.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {item.label}
                    {style === item.id && <Check className="size-3.5 text-primary" />}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      item.ecosystem === "google"
                        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                        : item.ecosystem === "apple"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {item.badge}
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 深浅色 + 界面密度 */}
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">深浅色（同步系统原生窗口）</p>
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
            <p className="text-xs font-medium text-muted-foreground">界面密度与字号</p>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted/60 p-1.5">
              {DENSITIES.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  title={d.description}
                  onClick={() => setDensity(d.id)}
                  aria-pressed={density === d.id}
                  className={cn(
                    "flex min-h-10 items-center justify-center rounded-xl px-2 text-xs font-medium transition-all duration-200 sm:text-sm",
                    density === d.id
                      ? "bg-card text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.08)] ring-1 ring-border/60"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Material You 自定义动态取色 */}
        <div
          className={cn(
            "space-y-3 rounded-2xl border p-4 transition-all",
            palette === "custom" ? "border-primary/55 bg-primary/[0.04] ring-1 ring-primary/20" : "border-border/70 bg-card/60"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Pipette className="size-4 text-primary" />
                Material You 动态取色（任意种子色）
                {palette === "custom" && <Check className="size-3.5 text-primary" />}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                像 Android Pixel 一样任选一个主色，自动衍生整套浅色与深色色板
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-2xs transition-colors hover:border-primary/50">
              <span className="size-4 rounded-full ring-1 ring-black/15" style={{ backgroundColor: seedColor }} />
              <span className="font-mono uppercase">{seedColor}</span>
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
          <div className="flex flex-wrap items-center gap-2">
            {CUSTOM_SEED_SWATCHES.map((item) => {
              const selected = palette === "custom" && seedColor.toLowerCase() === item.color.toLowerCase();
              return (
                <button
                  key={item.color}
                  type="button"
                  title={item.label}
                  onClick={() => {
                    setSeedColor(item.color);
                    setPalette("custom");
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all",
                    selected
                      ? "border-primary/60 bg-primary/10 font-medium text-foreground ring-1 ring-primary/25"
                      : "border-border/70 bg-card/80 text-muted-foreground hover:border-foreground/25 hover:text-foreground"
                  )}
                >
                  <span className="size-3 rounded-full ring-1 ring-black/15" style={{ backgroundColor: item.color }} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Apple 生态色系 */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Apple 生态色系（iPhone / macOS）</p>
            <span className="text-xs text-muted-foreground">{applePalettes.length} 种</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {applePalettes.map((p) => (
              <PaletteCard key={p.id} p={p} active={palette === p.id} isDark={isDark} onSelect={setPalette} />
            ))}
          </div>
        </div>

        {/* Google / Android Material You 色系 */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Google · Android Material You 色系（Pixel 动态色）</p>
            <span className="text-xs text-muted-foreground">{googlePalettes.length} 种</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {googlePalettes.map((p) => (
              <PaletteCard key={p.id} p={p} active={palette === p.id} isDark={isDark} onSelect={setPalette} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
