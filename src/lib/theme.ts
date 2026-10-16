export type ThemeMode = "light" | "dark" | "system";
export type ThemePalette = "indigo" | "tech" | "mono" | "titanium" | "aurora" | "champagne";

/** How surfaces look, independent of color: flat and quiet, frosted glass, or the original soft cards. */
export type ThemeStyle = "soft" | "minimal" | "glass" | "classic";

export const THEME_MODE_KEY = "careerplatform:theme-mode";
export const THEME_PALETTE_KEY = "careerplatform:theme-palette";
export const THEME_STYLE_KEY = "careerplatform:theme-style";

export const STYLES: { id: ThemeStyle; label: string; description: string }[] = [
  { id: "soft", label: "柔光", description: "白色悬浮卡片、柔和阴影和渐变，系统字体" },
  { id: "minimal", label: "简约", description: "平整留白，细线分隔，没有阴影和光晕" },
  { id: "glass", label: "通透", description: "磨砂玻璃卡片，柔和的彩色光晕" },
  { id: "classic", label: "经典", description: "原来的圆润卡片和渐变按钮" },
];

export const PALETTES: { id: ThemePalette; label: string; description: string; swatch: string; surface: string }[] = [
  { id: "indigo", label: "星云靛蓝", description: "柔和紫蓝 · 默认", swatch: "#5b5ce6", surface: "#f6f6fb" },
  { id: "tech", label: "深空蓝", description: "冷调蓝光 · 科技", swatch: "#2871df", surface: "#f3f7fc" },
  { id: "mono", label: "石墨黑白", description: "纯粹中性 · 极简", swatch: "#272a30", surface: "#f8f8f8" },
  { id: "titanium", label: "钛金银", description: "银灰材质 · 克制", swatch: "#64748b", surface: "#f4f6f8" },
  { id: "aurora", label: "极光青", description: "冰川青绿 · 未来", swatch: "#0b9f98", surface: "#f0f8f7" },
  { id: "champagne", label: "香槟白", description: "温润暖金 · 优雅", swatch: "#aa7954", surface: "#faf7f3" },
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
export function applyTheme(mode: ThemeMode, palette: ThemePalette, style: ThemeStyle) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolveIsDark(mode));
  root.setAttribute("data-palette", palette);
  root.setAttribute("data-style", style);
}
