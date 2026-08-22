export type ThemeMode = "light" | "dark" | "system";
export type ThemePalette = "indigo" | "tech" | "mono";

export const THEME_MODE_KEY = "careerplatform:theme-mode";
export const THEME_PALETTE_KEY = "careerplatform:theme-palette";

export const PALETTES: { id: ThemePalette; label: string; swatch: string }[] = [
  { id: "indigo", label: "靛蓝", swatch: "#4f46e5" },
  { id: "tech", label: "科技蓝·深空", swatch: "#2563eb" },
  { id: "mono", label: "灰调极简", swatch: "#18181b" },
];

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Applies mode+palette to <html>. Shared by the blocking no-flash script
 * (as an inline string, see layout.tsx) and the client provider — keep the
 * logic identical between the two or the first paint won't match. */
export function applyTheme(mode: ThemeMode, palette: ThemePalette) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolveIsDark(mode));
  root.setAttribute("data-palette", palette);
}
