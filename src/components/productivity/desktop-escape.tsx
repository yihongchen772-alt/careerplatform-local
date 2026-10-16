"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * The /desktop pages are made for their own small windows and have no
 * sidebar. If one ends up in the main window (only it has desktopBridge),
 * there must still be a way back.
 */
export function DesktopEscape() {
  const inMainWindow = useSyncExternalStore(subscribe, () => "desktopBridge" in window, () => false);
  if (!inMainWindow) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-b bg-muted/60 px-4 py-2 text-sm">
      <span className="text-muted-foreground">这是独立小窗口用的页面</span>
      <a href="/dashboard" className="font-medium text-primary hover:underline">← 返回求职罗盘</a>
    </div>
  );
}
