export type ThemeMode = "light" | "dark" | "system";
export type ThemePalette = "indigo" | "tech" | "mono" | "titanium" | "aurora" | "champagne";

/** How surfaces look, independent of color: flat and quiet, frosted glass, or the original soft cards. */
export type ThemeStyle = "soft" | "minimal" | "glass" | "classic";

export const THEME_MODE_KEY = "careerplatform:theme-mode";
export const THEME_PALETTE_KEY = "careerplatform:theme-palette";
export const THEME_STYLE_KEY = "careerplatform:theme-style";

export const STYLES: { id: ThemeStyle; label: string; description: string }[] = [
  { id: "soft", label: "iOS 柔光岛", description: "Apple Bento 悬浮岛、大圆角卡片与柔光阴影" },
  { id: "glass", label: "液态毛玻璃", description: "visionOS 高通透磨砂玻璃与浓郁极光景深" },
  { id: "classic", label: "macOS 炫彩", description: "原生桌面侧栏、流光渐变横幅与立体按钮" },
  { id: "minimal", label: "纯粹极简", description: "Apple 编辑室留白、1px 锐利线条与零光晕" },
];

export const PALETTES: { id: ThemePalette; label: string; description: string; swatch: string; surface: string }[] = [
  { id: "indigo", label: "星云紫蓝", description: "iPhone Pro 靛紫 · 默认", swatch: "#5b5ce6", surface: "#f2f2fc" },
  { id: "tech", label: "天峰冰蓝", description: "Apple 官网蓝 · 清冽科技", swatch: "#0071e3", surface: "#edf5ff" },
  { id: "aurora", label: "翡翠极光", description: "冰川薄荷 · 灵动青绿", swatch: "#0d9488", surface: "#eaf8f5" },
  { id: "champagne", label: "沙漠钛金", description: "温润暖金 · 羊皮纸感", swatch: "#b87333", surface: "#fbf5ec" },
  { id: "titanium", label: "原色钛金属", description: "冷冽银灰蓝 · 精密工业", swatch: "#4b6584", surface: "#eef3f8" },
  { id: "mono", label: "曜石黑白", description: "Studio 纯粹高对比", swatch: "#1d1d1f", surface: "#f5f5f7" },
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
