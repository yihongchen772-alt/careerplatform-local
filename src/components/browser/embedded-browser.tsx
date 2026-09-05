"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ChevronLeft, RotateCw, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DesktopBridgeAutofillStatus, DesktopBridgeNavState } from "@/types/desktop-bridge";

type ResumeOption = { id: string; name: string; isDefault: boolean };

export function EmbeddedBrowser({
  initialUrl,
  resumeVersions,
}: {
  initialUrl?: string;
  resumeVersions: ResumeOption[];
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const [addressInput, setAddressInput] = useState(initialUrl ?? "");
  const [navState, setNavState] = useState<DesktopBridgeNavState | null>(null);
  const [status, setStatus] = useState<DesktopBridgeAutofillStatus | null>(null);
  const [autofilling, setAutofilling] = useState(false);
  const [resumeVersionId, setResumeVersionId] = useState(
    resumeVersions.find((r) => r.isDefault)?.id ?? resumeVersions[0]?.id ?? ""
  );

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
    bridge.autofill(resumeVersionId || undefined);
  }

  if (!bridge) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        网申浏览器只在桌面版里可用
      </div>
    );
  }

  const zoomPercent = Math.round((navState?.zoomFactor ?? 1) * 100);

  return (
    <div className="flex h-full flex-col gap-2">
      <button
        type="button"
        onClick={() => router.back()}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        返回
      </button>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
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
        <form onSubmit={handleNavigate} className="min-w-32 flex-1">
          <Input
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            placeholder="输入网申页面地址..."
            className="h-9"
          />
        </form>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => bridge.zoomOut()}
            aria-label="缩小"
          >
            <ZoomOut className="size-4" />
          </Button>
          <button
            type="button"
            onClick={() => bridge.zoomReset()}
            className="w-11 shrink-0 text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {zoomPercent}%
          </button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => bridge.zoomIn()}
            aria-label="放大"
          >
            <ZoomIn className="size-4" />
          </Button>
        </div>
        {resumeVersions.length > 0 && (
          <Select value={resumeVersionId} onValueChange={(v) => v && setResumeVersionId(v)}>
            <SelectTrigger className="h-9 w-40 shrink-0">
              <SelectValue placeholder="选简历">
                {(value: string) =>
                  resumeVersions.find((r) => r.id === value)?.name ?? "选简历"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {resumeVersions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
