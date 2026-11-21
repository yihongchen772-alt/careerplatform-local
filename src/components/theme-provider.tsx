"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import {
  applyTheme,
  normalizeDensity,
  normalizePalette,
  normalizeSeedColor,
  normalizeStyle,
  THEME_DENSITY_KEY,
  THEME_MODE_KEY,
  THEME_PALETTE_KEY,
  THEME_SEED_KEY,
  THEME_STYLE_KEY,
  type ThemeDensity,
  type ThemeMode,
  type ThemePalette,
  type ThemeStyle,
} from "@/lib/theme";

type ThemeContextValue = {
  mode: ThemeMode;
  palette: ThemePalette;
  style: ThemeStyle;
  density: ThemeDensity;
  seedColor: string;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: ThemePalette) => void;
  setStyle: (style: ThemeStyle) => void;
  setDensity: (density: ThemeDensity) => void;
  setSeedColor: (color: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function makeStore<T extends string>(key: string, fallback: T) {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot(): T {
      return (localStorage.getItem(key) as T | null) ?? fallback;
    },
    getServerSnapshot(): T {
      return fallback;
    },
    set(value: T) {
      localStorage.setItem(key, value);
      listeners.forEach((l) => l());
    },
  };
}

const modeStore = makeStore<ThemeMode>(THEME_MODE_KEY, "system");
const paletteStore = makeStore<ThemePalette>(THEME_PALETTE_KEY, "indigo");
const styleStore = makeStore<ThemeStyle>(THEME_STYLE_KEY, "soft");
const densityStore = makeStore<ThemeDensity>(THEME_DENSITY_KEY, "standard");
const seedStore = makeStore<string>(THEME_SEED_KEY, "#1a73e8");

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useSyncExternalStore(
    modeStore.subscribe,
    modeStore.getSnapshot,
    modeStore.getServerSnapshot
  );
  const rawPalette = useSyncExternalStore(
    paletteStore.subscribe,
    paletteStore.getSnapshot,
    paletteStore.getServerSnapshot
  );
  const rawStyle = useSyncExternalStore(
    styleStore.subscribe,
    styleStore.getSnapshot,
    styleStore.getServerSnapshot
  );
  const rawDensity = useSyncExternalStore(
    densityStore.subscribe,
    densityStore.getSnapshot,
    densityStore.getServerSnapshot
  );
  const rawSeed = useSyncExternalStore(
    seedStore.subscribe,
    seedStore.getSnapshot,
    seedStore.getServerSnapshot
  );

  const palette = normalizePalette(rawPalette);
  const style = normalizeStyle(rawStyle);
  const density = normalizeDensity(rawDensity);
  const seedColor = normalizeSeedColor(rawSeed);

  useEffect(() => {
    applyTheme(mode, palette, style, density, seedColor);
    if (mode !== "system") return;
    // "跟随系统" needs to react live if the OS theme flips while the tab is open.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(mode, palette, style, density, seedColor);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode, palette, style, density, seedColor]);

  return (
    <ThemeContext.Provider
      value={{
        mode,
        palette,
        style,
        density,
        seedColor,
        setMode: modeStore.set,
        setPalette: paletteStore.set,
        setStyle: styleStore.set,
        setDensity: densityStore.set,
        setSeedColor: seedStore.set,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeSettings(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeSettings must be used inside ThemeProvider");
  return ctx;
}
