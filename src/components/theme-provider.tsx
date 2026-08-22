"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import {
  applyTheme,
  THEME_MODE_KEY,
  THEME_PALETTE_KEY,
  type ThemeMode,
  type ThemePalette,
} from "@/lib/theme";

type ThemeContextValue = {
  mode: ThemeMode;
  palette: ThemePalette;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: ThemePalette) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// A localStorage-backed value is a textbook case for useSyncExternalStore
// rather than useState+useEffect: the server has no localStorage, so
// useState's initial render would show a default that differs from what the
// client actually has stored, producing a hydration mismatch (confirmed —
// this used to log "server rendered HTML didn't match" on any hard load of
// /settings for a user with a non-default theme). useSyncExternalStore's
// getServerSnapshot/getSnapshot split is designed for exactly this: React
// treats the client value as correct on hydration without warning, and
// without the extra render tick a mount-effect would need.
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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useSyncExternalStore(
    modeStore.subscribe,
    modeStore.getSnapshot,
    modeStore.getServerSnapshot
  );
  const palette = useSyncExternalStore(
    paletteStore.subscribe,
    paletteStore.getSnapshot,
    paletteStore.getServerSnapshot
  );

  useEffect(() => {
    applyTheme(mode, palette);
    if (mode !== "system") return;
    // "跟随系统" needs to react live if the OS theme flips while the tab is open.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(mode, palette);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode, palette]);

  return (
    <ThemeContext.Provider
      value={{ mode, palette, setMode: modeStore.set, setPalette: paletteStore.set }}
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
