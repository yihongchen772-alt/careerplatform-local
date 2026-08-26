import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegister } from "@/components/sw-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "求职罗盘",
  description: "投递记录、面试进展与岗位匹配管理",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "求职罗盘",
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  // Let the page paint under the notch/home indicator; layout adds
  // env(safe-area-inset-*) padding so nothing lands under them.
  viewportFit: "cover",
};

// Runs before hydration so the theme is already correct on first paint —
// without this the page would flash the default indigo/light theme and then
// snap to whatever the user actually picked once ThemeProvider mounts.
// Keep this logic identical to applyTheme() in src/lib/theme.ts.
const NO_FLASH_THEME_SCRIPT = `
(function () {
  try {
    var mode = localStorage.getItem("careerplatform:theme-mode") || "system";
    var palette = localStorage.getItem("careerplatform:theme-palette") || "indigo";
    var isDark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var root = document.documentElement;
    if (isDark) root.classList.add("dark");
    root.setAttribute("data-palette", palette);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The no-flash script below mutates this element's class/data-palette
      // before React hydrates, on purpose — that intentional mismatch is
      // exactly what suppressHydrationWarning exists for (same approach
      // next-themes itself uses), scoped to just this one element.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
