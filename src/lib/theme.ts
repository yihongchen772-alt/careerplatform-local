export type ThemeMode = "light" | "dark" | "system";
export type ThemePalette =
  | "indigo"
  | "tech"
  | "aurora"
  | "champagne"
  | "titanium"
  | "mono"
  | "google"
  | "pixel-lavender"
  | "pixel-sage"
  | "pixel-coral"
  | "rose"
  | "amber";

/** How surfaces look, independent of color: Apple (iOS/Liquid Glass/macOS), Google (Material You/Workspace), or Minimalist Studio. */
export type ThemeStyle = "soft" | "glass" | "classic" | "material" | "pixel" | "minimal";

export type ThemeEcosystem = "apple" | "google" | "studio";

export const THEME_MODE_KEY = "careerplatform:theme-mode";
export const THEME_PALETTE_KEY = "careerplatform:theme-palette";
export const THEME_STYLE_KEY = "careerplatform:theme-style";

export const STYLES: {
  id: ThemeStyle;
  label: string;
  ecosystem: ThemeEcosystem;
  badge: string;
  description: string;
}[] = [
  {
    id: "soft",
    label: "iOS 柔光岛",
    ecosystem: "apple",
    badge: "Apple",
    description: "Apple Bento 悬浮岛、大圆角白卡与柔光高光",
  },
  {
    id: "glass",
    label: "iOS 26 液态玻璃",
    ecosystem: "apple",
    badge: "Apple",
    description: "Liquid Glass 折射镜面玻璃与多层极光景深",
  },
  {
    id: "classic",
    label: "macOS 炫彩",
    ecosystem: "apple",
    badge: "Apple",
    description: "原生桌面侧栏、流光渐变横幅与立体按钮",
  },
  {
    id: "material",
    label: "Android Material You",
    ecosystem: "google",
    badge: "Android · M3",
    description: "Google M3 色调分层、28dp 亲和大圆角与药丸导航",
  },
  {
    id: "pixel",
    label: "Google 晴空桌面",
    ecosystem: "google",
    badge: "Google",
    description: "Gmail / Drive 半药丸侧栏、清透白卡与高可读排版",
  },
  {
    id: "minimal",
    label: "纯粹极简",
    ecosystem: "studio",
    badge: "Studio",
    description: "编辑室留白、1px 锐利线条与零光晕专注阅读",
  },
];

export const PALETTES: {
  id: ThemePalette;
  label: string;
  ecosystem: "apple" | "google";
  description: string;
  swatch: string;
  swatch2: string;
  surface: string;
  darkSurface: string;
}[] = [
  // Apple 生态色系
  {
    id: "indigo",
    label: "星云紫蓝",
    ecosystem: "apple",
    description: "iPhone Pro 靛紫 · 默认",
    swatch: "#5147e5",
    swatch2: "#9366f5",
    surface: "#f2f2fc",
    darkSurface: "#141625",
  },
  {
    id: "tech",
    label: "天峰冰蓝",
    ecosystem: "apple",
    description: "Apple 官网蓝 · 清冽科技",
    swatch: "#0071e3",
    swatch2: "#00a8e8",
    surface: "#edf5ff",
    darkSurface: "#0e1a2c",
  },
  {
    id: "aurora",
    label: "翡翠极光",
    ecosystem: "apple",
    description: "冰川薄荷 · 灵动青绿",
    swatch: "#0b8a82",
    swatch2: "#06b6d4",
    surface: "#e9f6f3",
    darkSurface: "#0c2022",
  },
  {
    id: "champagne",
    label: "沙漠钛金",
    ecosystem: "apple",
    description: "iPhone Pro 暖金 · 温润质感",
    swatch: "#a36635",
    swatch2: "#d89f6c",
    surface: "#f8f2ea",
    darkSurface: "#1e1712",
  },
  {
    id: "titanium",
    label: "原色钛金属",
    ecosystem: "apple",
    description: "冷冽银灰蓝 · 精密工业",
    swatch: "#445d7a",
    swatch2: "#748da6",
    surface: "#ecf0f5",
    darkSurface: "#151c25",
  },
  {
    id: "mono",
    label: "曜石黑白",
    ecosystem: "apple",
    description: "Apple Studio 纯粹高对比",
    swatch: "#1d1d1f",
    swatch2: "#6e6e73",
    surface: "#f5f5f7",
    darkSurface: "#0e0e11",
  },

  // Google / Android Material You 色系
  {
    id: "google",
    label: "Google 晴空蓝",
    ecosystem: "google",
    description: "Chrome / Android 标志蓝",
    swatch: "#1a73e8",
    swatch2: "#4285f4",
    surface: "#eef4fc",
    darkSurface: "#11161f",
  },
  {
    id: "pixel-lavender",
    label: "M3 薰衣草紫",
    ecosystem: "google",
    description: "Material You 官方丁香紫",
    swatch: "#6750a4",
    swatch2: "#9a82db",
    surface: "#f5effa",
    darkSurface: "#16131d",
  },
  {
    id: "pixel-sage",
    label: "Pixel 鼠尾草绿",
    ecosystem: "google",
    description: "Android 15 护眼灰绿",
    swatch: "#386a4b",
    swatch2: "#6ea884",
    surface: "#eef5ef",
    darkSurface: "#101712",
  },
  {
    id: "pixel-coral",
    label: "Pixel 珊瑚陶橘",
    ecosystem: "google",
    description: "Material You 暖阳赤陶",
    swatch: "#c44d34",
    swatch2: "#e88464",
    surface: "#fcf1ec",
    darkSurface: "#1c1310",
  },
  {
    id: "rose",
    label: "樱花粉雾",
    ecosystem: "google",
    description: "Pixel 玫瑰石英 · 温柔清透",
    swatch: "#cf3f70",
    swatch2: "#f07aa1",
    surface: "#fdf0f5",
    darkSurface: "#1c1116",
  },
  {
    id: "amber",
    label: "暖阳琥珀金",
    ecosystem: "google",
    description: "Material You 蜂蜜晨光",
    swatch: "#b4690e",
    swatch2: "#e09c38",
    surface: "#fbf5e8",
    darkSurface: "#1b160d",
  },
];

export const THEME_PRESETS: {
  id: string;
  label: string;
  tag: string;
  style: ThemeStyle;
  palette: ThemePalette;
  swatch: string;
  swatch2: string;
}[] = [
  {
    id: "ios-bento",
    label: "iPhone 柔光",
    tag: "Apple",
    style: "soft",
    palette: "tech",
    swatch: "#0071e3",
    swatch2: "#00a8e8",
  },
  {
    id: "ios-liquid",
    label: "iOS 26 液态玻璃",
    tag: "Apple",
    style: "glass",
    palette: "indigo",
    swatch: "#5147e5",
    swatch2: "#9366f5",
  },
  {
    id: "android-m3",
    label: "Android Material You",
    tag: "Android",
    style: "material",
    palette: "pixel-lavender",
    swatch: "#6750a4",
    swatch2: "#9a82db",
  },
  {
    id: "pixel-sage-m3",
    label: "Pixel 护眼鼠尾草",
    tag: "Android",
    style: "material",
    palette: "pixel-sage",
    swatch: "#386a4b",
    swatch2: "#6ea884",
  },
  {
    id: "google-workspace",
    label: "Google 晴空桌面",
    tag: "Google",
    style: "pixel",
    palette: "google",
    swatch: "#1a73e8",
    swatch2: "#4285f4",
  },
  {
    id: "studio-mono",
    label: "Studio 极简黑白",
    tag: "Studio",
    style: "minimal",
    palette: "mono",
    swatch: "#1d1d1f",
    swatch2: "#6e6e73",
  },
];

const VALID_STYLES = new Set<string>(STYLES.map((s) => s.id));
const VALID_PALETTES = new Set<string>(PALETTES.map((p) => p.id));

export function normalizeStyle(value: string | null | undefined): ThemeStyle {
  return value && VALID_STYLES.has(value) ? (value as ThemeStyle) : "soft";
}

export function normalizePalette(value: string | null | undefined): ThemePalette {
  return value && VALID_PALETTES.has(value) ? (value as ThemePalette) : "indigo";
}

export function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Applies mode+palette+style to <html>. Shared by the blocking no-flash script
 * (as an inline string, see layout.tsx) and the client provider — keep the
 * logic identical between the two or the first paint won't match. */
export function applyTheme(mode: ThemeMode, palette: ThemePalette, style: ThemeStyle) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolveIsDark(mode));
  root.setAttribute("data-palette", normalizePalette(palette));
  root.setAttribute("data-style", normalizeStyle(style));
}
