"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DesktopBridgeAutofillStatus, DesktopBridgeNavState } from "@/types/desktop-bridge";

export function EmbeddedBrowser({ initialUrl }: { initialUrl?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [addressInput, setAddressInput] = useState(initialUrl ?? "");
  const [navState, setNavState] = useState<DesktopBridgeNavState | null>(null);
  const [status, setStatus] = useState<DesktopBridgeAutofillStatus | null>(null);
  const [autofilling, setAutofilling] = useState(false);

  const bridge = typeof window !== "undefined" ? window.desktopBridge : undefined;

  useEffect(() => {
    if (!bridge) return;
    const offNav = bridge.onNavState((state) => {
      setNavState(state);
      setAddressInput(state.url);
    });
    const offStatus = bridge.onAutofillStatus((s) => {
      setStatus(s);
      if (s.phase === "done" || s.phase === "error") setAutofilling(false);
    });
    if (initialUrl) bridge.navigate(initialUrl);
    return () => {
      offNav();
      offStatus();
    };
    // Only wire this up once per mount — re-running on every initialUrl
    // change would re-navigate away from wherever the user has since clicked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !panelRef.current) return;
    const el = panelRef.current;
    const report = () => {
      const rect = el.getBoundingClientRect();
      bridge.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      bridge.setBounds(null);
    };
  }, [bridge]);

  function handleNavigate(e: React.FormEvent) {
    e.preventDefault();
    bridge?.navigate(addressInput);
  }

  function handleAutofill() {
    if (!bridge || autofilling) return;
    setAutofilling(true);
    setStatus({ phase: "scanning", message: "正在读取页面…" });
    bridge.autofill();
  }

  if (!bridge) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        网申浏览器只在桌面版里可用
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2 rounded-lg border bg-card p-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!navState?.canGoBack}
          onClick={() => bridge.back()}
          aria-label="后退"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!navState?.canGoForward}
          onClick={() => bridge.forward()}
          aria-label="前进"
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => bridge.reload()}
          aria-label="刷新"
        >
          <RotateCw className={navState?.loading ? "size-4 animate-spin" : "size-4"} />
        </Button>
        <form onSubmit={handleNavigate} className="min-w-0 flex-1">
          <Input
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="输入网申页面地址..."
            className="h-9"
          />
        </form>
        <Button type="button" size="sm" disabled={autofilling} onClick={handleAutofill}>
          <Sparkles className="size-4" />
          {autofilling ? "填充中..." : "AI 一键填充"}
        </Button>
      </div>

      {status && (
        <p
          className={
            status.phase === "error"
              ? "rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
              : "rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground"
          }
        >
          {status.message}
        </p>
      )}

      <div ref={panelRef} className="min-h-0 flex-1 rounded-lg border bg-muted/30" />
    </div>
  );
}
