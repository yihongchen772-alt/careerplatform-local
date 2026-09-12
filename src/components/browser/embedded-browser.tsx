"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Camera,
  Check,
  ChevronLeft,
  Compass,
  Copy,
  ExternalLink,
  Eraser,
  MoreHorizontal,
  Plus,
  Radar,
  RotateCw,
  Search,
  Send,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiProgress } from "@/components/ui/ai-progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseJd } from "@/lib/actions/jd-parse";
import { PositionFormDialog, type PositionFormInitial } from "@/components/pool/position-form-dialog";
import { PortalSyncDialog, type PortalCompany } from "@/components/browser/portal-sync-dialog";
import { QuickOpenDialog, type QuickLinks } from "@/components/browser/quick-open-dialog";
import { MarkAppliedFromBrowserDialog, type PoolPosition } from "@/components/browser/mark-applied-from-browser";
import { ScreenshotDialog, type ApplicationOption } from "@/components/browser/screenshot-dialog";
import type {
  DesktopBridgeAutofillStatus,
  DesktopBridgeTab,
  DesktopBridgeTabsState,
} from "@/types/desktop-bridge";

type ResumeOption = { id: string; name: string; isDefault: boolean };

// Best-effort 渠道 from the page's host, so the saved position already says
// where it came from; anything unrecognised is treated as the company's own
// careers site, which is what the embedded browser is mostly used for.
export function sourceFromUrl(url: string): string {
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

// The bridge only exists in the Electron renderer. Reading window.* during
// render would make the server and client disagree on the first paint
// (hydration mismatch); useSyncExternalStore gives the server snapshot
// "not there" and the client its real answer, cleanly.
const noop = () => () => {};
function useDesktopBridge() {
  return useSyncExternalStore(
    noop,
    () => window.desktopBridge,
    () => undefined
  );
}

function shortTitle(tab: DesktopBridgeTab) {
  if (tab.title) return tab.title;
  if (!tab.url || tab.url === "about:blank") return "新标签页";
  try {
    return new URL(tab.url).hostname;
  } catch {
    return tab.url;
  }
}

export function EmbeddedBrowser({
  initialUrl,
  resumeVersions,
  portalCompanies,
  quickLinks,
  poolPositions,
  applications,
}: {
  initialUrl?: string;
  resumeVersions: ResumeOption[];
  portalCompanies: PortalCompany[];
  quickLinks: QuickLinks;
  poolPositions: PoolPosition[];
  applications: ApplicationOption[];
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const [tabsState, setTabsState] = useState<DesktopBridgeTabsState>({ tabs: [], activeId: null });
  // null = "show the active tab's URL"; a string = what the user is typing.
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  const [status, setStatus] = useState<DesktopBridgeAutofillStatus | null>(null);
  const [autofilling, setAutofilling] = useState(false);
  const [savingCorrections, setSavingCorrections] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureInitial, setCaptureInitial] = useState<PositionFormInitial | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  // Bumped per capture so the dialog remounts with the new `initial` instead
  // of showing stale form state from the previous page's parse.
  const [captureKey, setCaptureKey] = useState(0);
  const [portalOpen, setPortalOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const [shotOpen, setShotOpen] = useState(false);
  const [shot, setShot] = useState<{ dataUrl: string; title: string } | null>(null);
  // Popovers (resume select, the ⋯ menu) render in the DOM, which the
  // native WebContentsView is composited *above* — so while any of them
  // is open the view is detached, same as for dialogs.
  const [resumeMenuOpen, setResumeMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [findResult, setFindResult] = useState<{ active: number; total: number } | null>(null);
  const [resumeVersionId, setResumeVersionId] = useState(
    resumeVersions.find((r) => r.isDefault)?.id ?? resumeVersions[0]?.id ?? ""
  );
  // Multi-step wizard support: the main process reports "a form with N
  // empty fields just appeared" for the active tab; either show a one-line
  // prompt or, with 自动填每一页 on, just fill it.
  const [detected, setDetected] = useState<{ tabId: number; count: number; signature: string } | null>(null);
  const autoFillEveryPage = useSyncExternalStore(
    noop,
    () => {
      try {
        return localStorage.getItem("careerplatform.browser.autofillEveryPage") === "1";
      } catch {
        return false;
      }
    },
    () => false
  );
  const [autoFillOverride, setAutoFillOverride] = useState<boolean | null>(null);
  const autoFill = autoFillOverride ?? autoFillEveryPage;
  // Latest values for the long-lived IPC listener below, updated in an
  // effect (the lint rule forbids touching refs during render).
  const liveRef = useRef({ resumeVersionId, autoFill, autofilling });
  useEffect(() => {
    liveRef.current = { resumeVersionId, autoFill, autofilling };
  }, [resumeVersionId, autoFill, autofilling]);

  const bridge = useDesktopBridge();
  const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeId) ?? null;
  const currentUrl = activeTab?.url && activeTab.url !== "about:blank" ? activeTab.url : null;
  const overlayOpen =
    captureOpen || portalOpen || quickOpen || markOpen || shotOpen || resumeMenuOpen || moreOpen;

  useEffect(() => {
    if (!bridge) return;
    const offTabs = bridge.onTabs((state) => {
      setTabsState(state);
    });
    const offStatus = bridge.onAutofillStatus((s) => {
      setStatus(s);
      if (s.phase === "done" || s.phase === "error") setAutofilling(false);
    });
    const offShortcut = bridge.onShortcut(({ action, tabId }) => {
      if (action === "new-tab") void bridge.newTab();
      else if (action === "close-tab") void bridge.closeTab(tabId);
      else if (action === "focus-address") addressRef.current?.select();
      else if (action === "find") {
        setFindOpen(true);
        setTimeout(() => findRef.current?.select(), 50);
      }
    });
    const offDownload = bridge.onDownload((d) => {
      if (d.state === "completed") {
        toast.success(`已下载 ${d.filename} 到「下载」文件夹`, {
          action: { label: "打开位置", onClick: () => bridge.showDownload(d.path) },
        });
      } else {
        toast.error(`下载 ${d.filename} 失败`);
      }
    });
    const offFind = bridge.onFindResult((r) => setFindResult({ active: r.active, total: r.total }));
    const offForm = bridge.onFormDetected((payload) => {
      const live = liveRef.current;
      if (live.autofilling) return;
      if (live.autoFill && live.resumeVersionId) {
        setDetected(null);
        setAutofilling(true);
        setStatus({ phase: "scanning", message: `检测到新一页表单（${payload.count} 个字段），自动填充中…` });
        void bridge.autofill(live.resumeVersionId);
      } else {
        setDetected(payload);
      }
    });
    bridge.getTabs().then(setTabsState).catch(() => {});
    if (initialUrl) bridge.navigate(initialUrl);
    return () => {
      offTabs();
      offStatus();
      offShortcut();
      offDownload();
      offFind();
      offForm();
    };
    // Only wire this up once per mount — re-running on every initialUrl
    // change would re-navigate away from wherever the user has since clicked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  // Address bar follows the active tab unless the user is typing in it.
  const addressInput = addressDraft ?? currentUrl ?? "";

  useEffect(() => {
    if (!bridge || !panelRef.current) return;
    const el = panelRef.current;
    const report = () => {
      if (overlayOpen) {
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
  }, [bridge, overlayOpen]);

  // Keyboard shortcuts while focus is in our own chrome (the guest page's
  // shortcuts are forwarded by the main process and arrive via onShortcut).
  useEffect(() => {
    if (!bridge) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        void bridge.newTab();
      } else if (key === "w" && activeTab) {
        e.preventDefault();
        void bridge.closeTab(activeTab.id);
      } else if (key === "l") {
        e.preventDefault();
        addressRef.current?.select();
      } else if (key === "f") {
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => findRef.current?.select(), 50);
      } else if (key === "k") {
        e.preventDefault();
        setQuickOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [bridge, activeTab]);

  const runFind = useCallback(
    (text: string, forward = true, findNext = false) => {
      if (!bridge) return;
      if (!text.trim()) {
        setFindResult(null);
        void bridge.findStop();
        return;
      }
      void bridge.find({ text, forward, findNext });
    },
    [bridge]
  );

  function closeFind() {
    setFindOpen(false);
    setFindText("");
    setFindResult(null);
    void bridge?.findStop();
  }

  function handleNavigate(e: React.FormEvent) {
    e.preventDefault();
    bridge?.navigate(addressInput);
    setAddressDraft(null);
    addressRef.current?.blur();
  }

  function setAutoFillEveryPage(next: boolean) {
    setAutoFillOverride(next);
    try {
      localStorage.setItem("careerplatform.browser.autofillEveryPage", next ? "1" : "0");
    } catch {
      // per-device convenience only
    }
  }

  function handleAutofill() {
    if (!bridge || autofilling) return;
    setDetected(null);
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

  async function handleScreenshot() {
    if (!bridge) return;
    try {
      const result = await bridge.screenshot();
      setShot({ dataUrl: result.dataUrl, title: result.title });
      setShotOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "截图失败");
    }
  }

  if (!bridge) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        网申浏览器只在桌面版里可用
      </div>
    );
  }

  const zoomPercent = Math.round((activeTab?.zoomFactor ?? 1) * 100);

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

      {/* tab strip */}
      <div className="flex items-end gap-1 overflow-x-auto">
        {tabsState.tabs.map((tab) => {
          const active = tab.id === tabsState.activeId;
          return (
            <div
              key={tab.id}
              className={`group flex max-w-56 min-w-28 shrink-0 items-center gap-1 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-xs ${
                active ? "bg-card font-medium" : "bg-muted/40 text-muted-foreground hover:bg-muted"
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                title={tab.url}
                onClick={() => bridge.switchTab(tab.id)}
              >
                {tab.loading && <RotateCw className="mr-1 inline size-3 animate-spin" />}
                {shortTitle(tab)}
              </button>
              <button
                type="button"
                aria-label="关闭标签页"
                className="rounded p-0.5 opacity-60 hover:bg-muted-foreground/20 hover:opacity-100"
                onClick={() => bridge.closeTab(tab.id)}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        <Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label="新标签页" title="新标签页 (⌘T)" onClick={() => bridge.newTab()}>
          <Plus className="size-4" />
        </Button>
      </div>

      {/* navigation row */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card p-2">
        <Button type="button" variant="ghost" size="icon" disabled={!activeTab?.canGoBack} onClick={() => bridge.back()} aria-label="后退" title="后退 (⌘[)">
          <ArrowLeft className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" disabled={!activeTab?.canGoForward} onClick={() => bridge.forward()} aria-label="前进" title="前进 (⌘])">
          <ArrowRight className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => (activeTab?.loading ? bridge.stop() : bridge.reload())}
          aria-label={activeTab?.loading ? "停止" : "刷新"}
          title={activeTab?.loading ? "停止加载" : "刷新 (⌘R)"}
        >
          {activeTab?.loading ? <X className="size-4" /> : <RotateCw className="size-4" />}
        </Button>
        <form onSubmit={handleNavigate} className="min-w-40 flex-1">
          <Input
            ref={addressRef}
            value={addressInput}
            onChange={(e) => setAddressDraft(e.target.value)}
            onBlur={() => setAddressDraft(null)}
            placeholder="输入网址，或直接输入关键词搜索…  (⌘L)"
            className="h-9"
          />
        </form>
        <Button type="button" variant="outline" size="sm" onClick={() => setQuickOpen(true)} title="企业官网 / 候选岗位 JD / 进度页 / 最近访问 (⌘K)">
          <Compass className="size-4" />
          常用入口
        </Button>
        <Button type="button" variant={findOpen ? "secondary" : "ghost"} size="icon" aria-label="页内查找" title="页内查找 (⌘F)" onClick={() => (findOpen ? closeFind() : (setFindOpen(true), setTimeout(() => findRef.current?.select(), 50)))}>
          <Search className="size-4" />
        </Button>
        <div className="flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon" onClick={() => bridge.zoomOut()} aria-label="缩小">
            <ZoomOut className="size-4" />
          </Button>
          <button type="button" onClick={() => bridge.zoomReset()} className="w-11 shrink-0 text-center text-xs text-muted-foreground hover:text-foreground">
            {zoomPercent}%
          </button>
          <Button type="button" variant="ghost" size="icon" onClick={() => bridge.zoomIn()} aria-label="放大">
            <ZoomIn className="size-4" />
          </Button>
        </div>
        <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger
            render={<Button type="button" variant="ghost" size="icon" aria-label="更多" />}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!currentUrl} onClick={() => bridge.openExternal()}>
              <ExternalLink className="size-4" />
              在系统浏览器里打开
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!currentUrl}
              onClick={() => {
                void bridge.copyUrl();
                toast.success("链接已复制");
              }}
            >
              <Copy className="size-4" />
              复制链接
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!currentUrl} onClick={handleScreenshot}>
              <Camera className="size-4" />
              截图存到投递附件
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => bridge.clearMarks()}>
              <Eraser className="size-4" />
              清除填充标记
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                await bridge.clearHistory();
                toast.success("最近访问已清空");
              }}
            >
              清空最近访问
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                if (!window.confirm("会清掉网申浏览器里所有网站的登录状态和缓存（不影响 App 自己的数据），确定？")) return;
                await bridge.clearSiteData();
                toast.success("已退出所有网站登录");
              }}
            >
              退出所有网站登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {findOpen && (
        <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
          <Search className="size-4 text-muted-foreground" />
          <Input
            ref={findRef}
            value={findText}
            onChange={(e) => {
              setFindText(e.target.value);
              runFind(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runFind(findText, !e.shiftKey, true);
              } else if (e.key === "Escape") {
                closeFind();
              }
            }}
            placeholder="在页面里查找…"
            className="h-8 max-w-72"
          />
          <span className="text-xs text-muted-foreground">
            {findText ? (findResult ? `${findResult.active} / ${findResult.total}` : "…") : ""}
          </span>
          <Button type="button" variant="ghost" size="sm" disabled={!findText} onClick={() => runFind(findText, false, true)}>
            上一个
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={!findText} onClick={() => runFind(findText, true, true)}>
            下一个
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="关闭查找" onClick={closeFind}>
            <X className="size-4" />
          </Button>
        </div>
      )}

      {/* action row */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        {resumeVersions.length > 0 && (
          <Select value={resumeVersionId} onValueChange={(v) => v && setResumeVersionId(v)} onOpenChange={setResumeMenuOpen}>
            <SelectTrigger className="h-9 w-44 shrink-0">
              <SelectValue placeholder="选简历">
                {(value: string) => resumeVersions.find((r) => r.id === value)?.name ?? "选简历"}
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
        <Button type="button" size="sm" disabled={autofilling || !currentUrl} onClick={handleAutofill} title="按账号资料 + 简历自动填表单，含 iframe 里的表单和单选按钮">
          <Sparkles className="size-4" />
          {autofilling ? "填充中..." : "AI 一键填充"}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="网申分好几页时（基本信息→教育→实习→开放题），每翻到一页有空表单就自动填，不用每页点一次">
          <input type="checkbox" checked={autoFill} onChange={(e) => setAutoFillEveryPage(e.target.checked)} />
          每页自动填
        </label>
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
        <span className="mx-1 h-5 w-px bg-border" />
        <Button type="button" size="sm" variant="outline" disabled={capturing || !currentUrl} onClick={handleCapture} title="把当前页面的岗位信息用 AI 解析后加进候选岗位池">
          <Bookmark className="size-4" />
          {capturing ? "读取中..." : "收藏岗位"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={!currentUrl} onClick={() => setMarkOpen(true)} title="网申提交完了？一键把候选池里的这个岗位标成已投递，或直接新建一条投递记录">
          <Send className="size-4" />
          记为已投递
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setPortalOpen(true)} title="把当前的「我的投递」页面设为某家公司的进度页，之后自动同步投递阶段">
          <Radar className="size-4" />
          进度同步
        </Button>
      </div>

      {detected && !autofilling && detected.tabId === tabsState.activeId && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs">
          <span>这页有 {detected.count} 个可填字段。</span>
          <Button type="button" size="sm" className="h-7" onClick={handleAutofill}>
            <Sparkles className="size-3.5" />
            填这页
          </Button>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={autoFill} onChange={(e) => setAutoFillEveryPage(e.target.checked)} />
            以后每一页自动填
          </label>
          <button
            type="button"
            className="ml-auto text-muted-foreground hover:text-foreground"
            onClick={() => {
              void bridge.dismissForm({ tabId: detected.tabId, signature: detected.signature });
              setDetected(null);
            }}
          >
            这页不用
          </button>
        </div>
      )}
      <AiProgress
        active={autofilling && status?.phase === "ai"}
        expectedSeconds={30}
        stages={["正在把简历和字段交给 AI…", "AI 正在从简历里找对应信息、写开放题…", "正在写回页面…"]}
      />
      <AiProgress active={capturing} expectedSeconds={15} stages={["正在读页面正文…", "AI 正在解析公司/岗位/薪资并打分…"]} />
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

      <div ref={panelRef} className="relative min-h-0 flex-1 rounded-lg border bg-muted/30">
        {overlayOpen && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            页面暂时隐藏，关掉弹窗后恢复
          </p>
        )}
        {!overlayOpen && !currentUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>在上面输入网址，或从「常用入口」打开企业官网 / 候选岗位</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setQuickOpen(true)}>
              <Compass className="size-4" />
              常用入口
            </Button>
          </div>
        )}
      </div>

      <QuickOpenDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        links={quickLinks}
        onOpen={(url, inNewTab) => {
          if (inNewTab || !activeTab) void bridge.newTab(url);
          else void bridge.navigate(url);
          setQuickOpen(false);
        }}
      />

      {portalOpen && (
        <PortalSyncDialog
          open={portalOpen}
          onOpenChange={setPortalOpen}
          currentUrl={currentUrl}
          currentTitle={activeTab?.title ?? null}
          companies={portalCompanies}
        />
      )}

      {markOpen && (
        <MarkAppliedFromBrowserDialog
          open={markOpen}
          onOpenChange={setMarkOpen}
          pageTitle={activeTab?.title ?? ""}
          pageUrl={currentUrl ?? ""}
          positions={poolPositions}
          resumeVersions={resumeVersions}
        />
      )}

      {shotOpen && shot && (
        <ScreenshotDialog
          open={shotOpen}
          onOpenChange={setShotOpen}
          shot={shot}
          applications={applications}
        />
      )}

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
