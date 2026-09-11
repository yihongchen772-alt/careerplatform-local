"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Bookmark, ChevronLeft, RotateCw, Sparkles, Check, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseJd } from "@/lib/actions/jd-parse";
import { PositionFormDialog, type PositionFormInitial } from "@/components/pool/position-form-dialog";
import type { DesktopBridgeAutofillStatus, DesktopBridgeNavState } from "@/types/desktop-bridge";

// Best-effort 渠道 from the page's host, so the saved position already says
// where it came from; anything unrecognised is treated as the company's own
// careers site, which is what the embedded browser is mostly used for.
function sourceFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes("zhipin.com")) return "BOSS直聘";
    if (host.includes("nowcoder.com")) return "牛客";
    if (host.includes("liepin.com")) return "猎聘";
    if (host.includes("lagou.com")) return "拉勾";
    if (host.includes("zhaopin.com")) return "智联";
    if (host.includes("51job.com")) return "前程无忧";
    if (host.includes("shixiseng.com")) return "实习僧";
    return "官网";
  } catch {
    return "官网";
  }
}

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
  const [savingCorrections, setSavingCorrections] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureInitial, setCaptureInitial] = useState<PositionFormInitial | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  // Bumped per capture so the dialog remounts with the new `initial` instead
  // of showing stale form state from the previous page's parse.
  const [captureKey, setCaptureKey] = useState(0);
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
      // The WebContentsView is a native layer composited *above* this page's
      // DOM, so any dialog we open would render underneath it — detach the
      // view while one is up and put it back at the same bounds after.
      if (captureOpen) {
        bridge.setBounds(null);
        return;
      }
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
  }, [bridge, captureOpen]);

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

  async function handleSaveCorrections() {
    if (!bridge || savingCorrections) return;
    setSavingCorrections(true);
    try {
      const { saved } = await bridge.saveCorrections();
      if (saved > 0) {
        toast.success(`已把 ${saved} 处修改保存到答案库，下次遇到相似问题会直接用改过的版本`);
      } else {
        toast.info("没有检测到跟自动填充时不一样的内容");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存修改失败");
    } finally {
      setSavingCorrections(false);
    }
  }

  async function handleCapture() {
    if (!bridge || capturing) return;
    setCapturing(true);
    try {
      const page = await bridge.capturePage();
      if (!page.text || page.text.length < 20) {
        toast.error("这个页面上读不到岗位内容，等它加载完再试");
        return;
      }
      const res = await parseJd({ text: page.text });
      const parsed = res.ok ? res.data : null;
      if (!res.ok) toast.warning(`AI 没能解析这页（${res.message}），先帮你把链接和正文带过去，手动填一下`);
      setCaptureInitial({
        companyName: parsed?.companyName ?? "",
        title: parsed?.title ?? page.title ?? "",
        track: parsed?.track ?? null,
        department: parsed?.department ?? null,
        location: parsed?.location ?? null,
        salaryMin: parsed?.salaryMin ?? null,
        salaryMax: parsed?.salaryMax ?? null,
        jdUrl: page.url,
        jdText: page.text,
        source: sourceFromUrl(page.url),
        deadline: null,
        scoreBreakdown: parsed
          ? {
              techFit: Math.round(parsed.techFit),
              salary: Math.round(parsed.salaryScore),
              location: Math.round(parsed.locationScore),
              growth: Math.round(parsed.growthScore),
            }
          : null,
      });
      setCaptureKey((k) => k + 1);
      setCaptureOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "读取页面失败");
    } finally {
      setCapturing(false);
    }
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={capturing || !navState?.url || navState.url === "about:blank"}
          onClick={handleCapture}
          title="把当前页面的岗位信息用 AI 解析后加进候选岗位池"
        >
          <Bookmark className="size-4" />
          {capturing ? "读取中..." : "收藏岗位"}
        </Button>
        <Button type="button" size="sm" disabled={autofilling} onClick={handleAutofill}>
          <Sparkles className="size-4" />
          {autofilling ? "填充中..." : "AI 一键填充"}
        </Button>
        {status?.phase === "done" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={savingCorrections}
            onClick={handleSaveCorrections}
            title="如果你手动改过 AI 填的内容，点这个把改动存下来，下次遇到相似问题会直接用改过的版本"
          >
            <Check className="size-4" />
            {savingCorrections ? "保存中..." : "保存修改"}
          </Button>
        )}
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

      {captureInitial && (
        <PositionFormDialog
          key={captureKey}
          mode="create"
          initial={captureInitial}
          open={captureOpen}
          onOpenChange={setCaptureOpen}
        />
      )}
    </div>
  );
}
