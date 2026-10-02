"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Camera,
  Check,
  Compass,
  Copy,
  ExternalLink,
  FileCode,
  Eraser,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  NotebookPen,
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AiProgress } from "@/components/ui/ai-progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
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
import { SiteBanner, type KnownSite } from "@/components/browser/site-banner";
import type {
  DesktopBridgeAutofillModule,
  DesktopBridgeAutofillStatus,
  DesktopBridgeFillSource,
  DesktopBridgeTab,
  DesktopBridgeTabsState,
} from "@/types/desktop-bridge";

type ResumeOption = { id: string; name: string; isDefault: boolean };

export { sourceFromUrl } from "@/lib/source-from-url";
import { sourceFromUrl } from "@/lib/source-from-url";

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

// Same colours as the outlines fillFields draws on the page, so a dot here
// and a border there mean the same thing.
const FILL_SOURCES: { source: DesktopBridgeFillSource; label: string; dot: string }[] = [
  { source: "excluded", label: "未选择的模块", dot: "bg-muted-foreground/40" },
  { source: "manual", label: "需要你手填", dot: "bg-red-500" },
  { source: "ai", label: "AI 生成（紫红框）", dot: "bg-fuchsia-500" },
  { source: "memory", label: "记忆库 / 你的回答（绿框）", dot: "bg-green-600" },
  { source: "profile", label: "网申资料（紫框）", dot: "bg-violet-500" },
  { source: "prefilled", label: "页面原有内容", dot: "bg-muted-foreground/40" },
];

const FILL_MODULES: { id: DesktopBridgeAutofillModule; label: string }[] = [
  { id: "basic", label: "基本信息 / 求职意向" },
  { id: "education", label: "教育经历" },
  { id: "experience", label: "实习 / 工作经历" },
  { id: "project", label: "项目经历" },
  { id: "questions", label: "开放题 / 自我评价" },
  { id: "other", label: "其他字段" },
  { id: "resume", label: "简历附件" },
];
const ALL_FILL_MODULES = FILL_MODULES.map(({ id }) => id);

function FillDetails({ details }: { details: NonNullable<DesktopBridgeAutofillStatus["details"]> }) {
  const [onlyManual, setOnlyManual] = useState(false);
  const manual = details.filter((item) => item.source === "manual");
  const visible = onlyManual ? manual : details;
  return (
    <div className="mt-1 space-y-1">
      <div className="flex gap-2">
        <Button size="sm" variant={onlyManual ? "default" : "outline"} onClick={() => setOnlyManual(!onlyManual)}>{onlyManual ? "显示全部字段" : "只看未填 / 失败"}</Button>
      </div>
      {manual.length > 0 && (
        <p className="text-foreground">
          需要手填：{manual.slice(0, 8).map((item) => item.label).join("、")}
          {manual.length > 8 ? ` 等 ${manual.length} 项` : ""}
        </p>
      )}
      <details open>
        <summary className="cursor-pointer">
          逐字段来源（{FILL_SOURCES.map(({ source, label }) => {
            const count = details.filter((item) => (item.source ?? "profile") === source).length;
            return count ? `${label.replace(/（.*）/, "")} ${count}` : null;
          }).filter(Boolean).join(" · ")}）
        </summary>
        <div className="mt-1 max-h-48 space-y-2 overflow-auto">
          {FILL_SOURCES.map(({ source, label, dot }) => {
            const rows = visible.filter((item) => (item.source ?? "profile") === source);
            if (!rows.length) return null;
            return (
              <div key={source}>
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <span className={`inline-block size-2 rounded-full ${dot}`} />
                  {label}（{rows.length}）
                </p>
                <ul className="ml-3.5 space-y-0.5">
                  {rows.map((item, index) => (
                    <li key={`${item.label}-${index}`}>{item.label} · {item.state}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

export function EmbeddedBrowser({
  initialUrl,
  knownSites,
  profileVariants,
  resumeVersions,
  portalCompanies,
  quickLinks,
  poolPositions,
  applications,
}: {
  initialUrl?: string;
  knownSites: KnownSite[];
  profileVariants: { id: string; name: string; resumeVersionId: string | null }[];
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
  const [rememberedCount, setRememberedCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [autoHeight, setAutoHeight] = useState(true);
  const [resultOpen, setResultOpen] = useState(false);
  const activeIdRef = useRef<number | null>(null);
  const busyTabsRef = useRef(new Set<number>());
  const tabStatusRef = useRef(new Map<number, DesktopBridgeAutofillStatus>());
  const [browserHeight, setBrowserHeight] = useState(650);
  const autoSavingRef = useRef(false);
  const autoSaveErrorRef = useRef(false);
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
  // 资料方案: "" = 跟随简历 (the variant bound to the chosen resume, else the
  // default profile), "default" = always the default, otherwise a variant id.
  const [variantChoice, setVariantChoice] = useState("");
  const [variantMenuOpen, setVariantMenuOpen] = useState(false);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const scopePreference = useSyncExternalStore(noop, () => {
    try { return localStorage.getItem("careerplatform.browser.fillModules") ?? ALL_FILL_MODULES.join(","); }
    catch { return ALL_FILL_MODULES.join(","); }
  }, () => ALL_FILL_MODULES.join(","));
  const [scopeOverride, setScopeOverride] = useState<DesktopBridgeAutofillModule[] | null>(null);
  const fillModules = useMemo(() => scopeOverride ?? ALL_FILL_MODULES.filter((id) => scopePreference.split(",").includes(id)), [scopeOverride, scopePreference]);
  function setFillModules(modules: DesktopBridgeAutofillModule[]) {
    setScopeOverride(modules);
    try { localStorage.setItem("careerplatform.browser.fillModules", modules.join(",")); }
    catch { /* Keep the current selection even if local storage is unavailable. */ }
  }
  const [resumeVersionId, setResumeVersionId] = useState(
    resumeVersions.find((r) => r.isDefault)?.id ?? resumeVersions[0]?.id ?? ""
  );
  // Multi-step wizard support: the main process reports "a form with N
  // empty fields just appeared" for the active tab; either show a one-line
  // prompt or, with 自动填每一页 on, just fill it.
  const [detected, setDetected] = useState<{ tabId: number; count: number; signature: string } | null>(null);
  const [submitted, setSubmitted] = useState<{
    tabId: number;
    url: string;
    title: string;
    evidence: string;
  } | null>(null);
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
  const rememberedPreference = useSyncExternalStore(
    noop,
    () => {
      try { return localStorage.getItem("careerplatform.browser.autoRememberAnswers") !== "0"; }
      catch { return true; }
    },
    () => true
  );
  const expandPreference = useSyncExternalStore(
    noop,
    () => {
      try { return localStorage.getItem("careerplatform.browser.expandBlocks") === "1"; }
      catch { return false; }
    },
    () => false
  );
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null);
  const expandBlocks = expandOverride ?? expandPreference;
  const [rememberOverride, setRememberOverride] = useState<boolean | null>(null);
  const autoRemember = rememberOverride ?? rememberedPreference;
  // Latest values for the long-lived IPC listener below, updated in an
  // effect (the lint rule forbids touching refs during render).
  const liveRef = useRef({ resumeVersionId, autoFill, autofilling, expandBlocks, variantChoice, fillModules });
  useEffect(() => {
    liveRef.current = { resumeVersionId, autoFill, autofilling, expandBlocks, variantChoice, fillModules };
  }, [resumeVersionId, autoFill, autofilling, expandBlocks, variantChoice, fillModules]);

  const bridge = useDesktopBridge();
  const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeId) ?? null;
  const currentUrl = activeTab?.url && activeTab.url !== "about:blank" ? activeTab.url : null;
  const overlayOpen =
    captureOpen || portalOpen || quickOpen || markOpen || shotOpen || resumeMenuOpen || moreOpen || variantMenuOpen || scopeMenuOpen || resultOpen;
  const linkedVariant = profileVariants.find((v) => v.resumeVersionId && v.resumeVersionId === resumeVersionId);

  useEffect(() => {
    if (!bridge) return;
    const offTabs = bridge.onTabs((state) => {
      if (state.activeId !== activeIdRef.current) {
        activeIdRef.current = state.activeId;
        setStatus(state.activeId === null ? null : tabStatusRef.current.get(state.activeId) ?? null);
        setAutofilling(state.activeId !== null && busyTabsRef.current.has(state.activeId));
      }
      setTabsState(state);
    });
    const offStatus = bridge.onAutofillStatus((s) => {
      const tabId = s.tabId ?? activeIdRef.current;
      if (tabId !== null) {
        tabStatusRef.current.set(tabId, s);
        if (s.phase === "done" || s.phase === "error") busyTabsRef.current.delete(tabId);
        else busyTabsRef.current.add(tabId);
      }
      if (tabId === activeIdRef.current) {
        setStatus(s);
        setAutofilling(s.phase !== "done" && s.phase !== "error");
      }
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
      if (live.autofilling || payload.tabId !== activeIdRef.current) return;
      if (live.autoFill && live.fillModules.length > 0) {
        setDetected(null);
        setAutofilling(true);
        setStatus({ phase: "scanning", message: `检测到新一页表单（${payload.count} 个字段），自动填充中…` });
        void bridge.autofill(live.resumeVersionId || undefined, { expandBlocks: live.expandBlocks, variantId: live.variantChoice || undefined, modules: live.fillModules });
      } else {
        setDetected(payload);
      }
    });
    const offSubmitted = bridge.onApplicationSubmitted((payload) => {
      setSubmitted(payload);
      toast.success(`检测到“${payload.evidence}”，确认后可以记入投递看板`);
    });
    bridge.getTabs().then((state) => { activeIdRef.current = state.activeId; setTabsState(state); }).catch(() => {});
    if (initialUrl) bridge.navigate(initialUrl);
    return () => {
      offTabs();
      offStatus();
      offShortcut();
      offDownload();
      offFind();
      offForm();
      offSubmitted();
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
      const x = Math.max(0, rect.left);
      const y = Math.max(0, rect.top);
      const width = Math.min(rect.right, window.innerWidth) - x;
      const height = Math.min(rect.bottom, window.innerHeight) - y;
      bridge.setBounds(width > 0 && height > 0 ? { x, y, width, height } : null);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    window.addEventListener("scroll", report, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      window.removeEventListener("scroll", report, true);
      bridge.setBounds(null);
    };
  }, [bridge, overlayOpen]);

  useEffect(() => {
    if (!expanded) return;
    const main = panelRef.current?.closest("main") as HTMLElement | null;
    const previousZ = main?.style.zIndex ?? "";
    const previousOverflow = document.body.style.overflow;
    if (main) main.style.zIndex = "45";
    document.body.style.overflow = "hidden";
    return () => {
      if (main) main.style.zIndex = previousZ;
      document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  useEffect(() => {
    if (!bridge || !autoRemember || !currentUrl || autofilling || savingCorrections) return;
    const timer = window.setInterval(async () => {
      if (autoSavingRef.current) return;
      autoSavingRef.current = true;
      try {
        const { saved } = await bridge.saveCorrections(resumeVersionId || undefined, true);
        if (saved > 0) setRememberedCount((count) => count + saved);
        autoSaveErrorRef.current = false;
      } catch {
        if (!autoSaveErrorRef.current) toast.error("自动记住手填内容失败；可点「记住本页」重试");
        autoSaveErrorRef.current = true;
      } finally {
        autoSavingRef.current = false;
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [bridge, autoRemember, currentUrl, autofilling, savingCorrections, resumeVersionId]);

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

  function setExpandBlocks(next: boolean) {
    setExpandOverride(next);
    try { localStorage.setItem("careerplatform.browser.expandBlocks", next ? "1" : "0"); }
    catch { /* per-device preference only */ }
  }

  function setAutoRememberAnswers(next: boolean) {
    setRememberOverride(next);
    try { localStorage.setItem("careerplatform.browser.autoRememberAnswers", next ? "1" : "0"); }
    catch { /* per-device preference only */ }
  }

  function handleAutofill() {
    if (!bridge || autofilling) return;
    if (!fillModules.length) { toast.info("请先在「填写范围」里至少勾选一个模块"); return; }
    setDetected(null);
    setAutofilling(true);
    setStatus({ phase: "scanning", message: "正在读取页面…" });
    bridge.autofill(resumeVersionId || undefined, { expandBlocks, variantId: variantChoice || undefined, modules: fillModules });
  }

  async function handleSaveCorrections() {
    if (!bridge || savingCorrections) return;
    setSavingCorrections(true);
    try {
      const { saved } = await bridge.saveCorrections(resumeVersionId || undefined);
      if (saved > 0) {
        toast.success(`已记住 ${saved} 项你手填的内容，下次网申会优先复用`);
      } else {
        toast.info("这页没有可记住的新内容");
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
      const res = await parseJd({ text: page.text, capture: true });
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
        deadline: parsed?.deadline || null,
        recruitmentType: parsed?.recruitmentType || null,
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
    <div className={expanded ? "fixed inset-0 z-[45] flex flex-col gap-2 overflow-hidden bg-background p-3" : autoHeight ? "flex h-[calc(100dvh-10rem)] min-h-[24rem] flex-col gap-2" : "flex flex-col gap-2"}>
      {/* tab strip */}
      <div className="flex shrink-0 items-end gap-1 overflow-x-auto border-b">
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
      <div className="flex shrink-0 items-center gap-1 rounded-lg border bg-card p-1.5">
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
        <form onSubmit={handleNavigate} className="min-w-0 flex-1">
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
        <Button type="button" variant={expanded ? "secondary" : "outline"} size="sm" onClick={() => { setExpanded((value) => !value); setToolsOpen(false); }} title={expanded ? "退出专注模式" : "让网申页面占满工作区"}>
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          {expanded ? "退出专注" : "专注展开"}
        </Button>
        <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger
            render={<Button type="button" variant="ghost" size="icon" aria-label="更多" />}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={capturing || !currentUrl} onClick={handleCapture}><Bookmark className="size-4" />收藏当前岗位</DropdownMenuItem>
            <DropdownMenuItem disabled={!currentUrl} onClick={() => setMarkOpen(true)}><Send className="size-4" />记为已投递</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPortalOpen(true)}><Radar className="size-4" />设置进度同步</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={savingCorrections || !currentUrl} onClick={handleSaveCorrections}><Check className="size-4" />{savingCorrections ? "记忆中…" : "记住本页手填内容"}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings#answer-memory")}><NotebookPen className="size-4" />打开记忆库</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => bridge.zoomOut()}><ZoomOut className="size-4" />缩小网页</DropdownMenuItem>
            <DropdownMenuItem onClick={() => bridge.zoomReset()}>还原缩放（当前 {zoomPercent}%）</DropdownMenuItem>
            <DropdownMenuItem onClick={() => bridge.zoomIn()}><ZoomIn className="size-4" />放大网页</DropdownMenuItem>
            <DropdownMenuSeparator />
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
            <DropdownMenuItem
              disabled={!currentUrl}
              onClick={async () => {
                try {
                  const result = await bridge.exportFormStructure();
                  toast.success(`已导出表单结构（${result.fields} 个字段），文件在「下载」文件夹；已去掉填写内容和个人资料，可发给开发者排查`);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "导出失败");
                }
              }}
            >
              <FileCode className="size-4" />
              导出表单结构（反馈填错用）
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

      {/* Frequent filling controls stay visible in focus mode. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        {resumeVersions.length > 0 && (
          <Select disabled={autofilling} value={resumeVersionId || "none"} onValueChange={(v) => setResumeVersionId(v === "none" || !v ? "" : v)} onOpenChange={setResumeMenuOpen}>
            <SelectTrigger className="h-9 w-40 shrink-0">
              <SelectValue placeholder="选简历">
                {(value: string) => value === "none" ? "不用简历，只填资料" : resumeVersions.find((r) => r.id === value)?.name ?? "选简历"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不用简历，只填资料</SelectItem>
              {resumeVersions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {resumeVersions.length === 0 && <Button type="button" variant="outline" size="sm" title="添加简历后可用 AI 填写开放题和上传简历附件" onClick={() => router.push("/resumes")}>添加简历</Button>}
        <DropdownMenu open={scopeMenuOpen} onOpenChange={setScopeMenuOpen}>
          <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" className="max-w-48" disabled={autofilling} />}>
            <span className="truncate">填写范围：{fillModules.length === ALL_FILL_MODULES.length ? "全部模块" : fillModules.length === 1 ? FILL_MODULES.find(({ id }) => id === fillModules[0])?.label : `${fillModules.length} 个模块`}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <p className="px-2 py-1.5 text-xs text-muted-foreground">只补所选模块的空白，已填内容保留。<br />选择会记住，「每页自动填」也使用此范围。</p>
            <DropdownMenuItem onClick={() => setFillModules([...ALL_FILL_MODULES])}>全选</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFillModules([])}>取消全选</DropdownMenuItem>
            <DropdownMenuSeparator />
            {FILL_MODULES.map(({ id, label }) => (
              <DropdownMenuCheckboxItem key={id} checked={fillModules.includes(id)} closeOnClick={false} onCheckedChange={(checked) => setFillModules(checked ? [...fillModules, id] : fillModules.filter((item) => item !== id))}>
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" size="sm" disabled={autofilling || !currentUrl || !fillModules.length} onClick={handleAutofill} title="仅补填写范围内的空白字段，已填内容保留">
          <Sparkles className="size-4" />
          {autofilling ? "填充中..." : fillModules.length === ALL_FILL_MODULES.length ? "AI 一键填充" : "填写所选模块"}
        </Button>
        {autofilling && <Button type="button" size="sm" variant="outline" onClick={() => void bridge.cancelAutofill(tabsState.activeId ?? undefined)}>停止填写</Button>}
        <span className="hidden text-xs text-muted-foreground xl:inline">只补空白，已填内容保留</span>
        <Button type="button" size="sm" variant={toolsOpen ? "secondary" : "ghost"} className="ml-auto" onClick={() => setToolsOpen((value) => !value)}>{toolsOpen ? "收起设置" : "填写设置"}</Button>
      </div>
      {toolsOpen && <div className="flex max-h-44 min-h-0 flex-wrap items-center gap-x-4 gap-y-3 overflow-auto rounded-lg border bg-muted/30 p-3">
        {profileVariants.length > 0 && (
          <Select value={variantChoice || "auto"} onValueChange={(v) => setVariantChoice(!v || v === "auto" ? "" : v)} onOpenChange={setVariantMenuOpen}>
            <SelectTrigger className="h-9 w-44 shrink-0" title="网申资料方案：不同求职方向的实习/项目顺序和常问字段">
              <SelectValue>
                {(value: string) =>
                  value === "auto"
                    ? `方案：${linkedVariant ? linkedVariant.name : "默认资料"}（跟随简历）`
                    : `方案：${value === "default" ? "默认资料" : profileVariants.find((v) => v.id === value)?.name ?? "默认资料"}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">跟随简历</SelectItem>
              <SelectItem value="default">默认资料</SelectItem>
              {profileVariants.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="网申分好几页时（基本信息→教育→实习→开放题），每翻到一页有空表单就自动填，不用每页点一次">
          <input type="checkbox" checked={autoFill} onChange={(e) => setAutoFillEveryPage(e.target.checked)} />
          每页自动填
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="网申资料里的教育/实习/项目经历比页面上的栏目多时，自动点页面上的「添加教育经历」等按钮再接着填；只点文字明确的添加按钮，不会点提交">
          <input type="checkbox" checked={expandBlocks} onChange={(e) => setExpandBlocks(e.target.checked)} />
          自动补齐栏目
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="记住你手填或修改的基础资料与开放题；密码、证件、银行卡、验证码不保存">
          <input type="checkbox" checked={autoRemember} onChange={(e) => setAutoRememberAnswers(e.target.checked)} />
          自动记住手填内容
        </label>
        {!expanded && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">网页视区</span>
          <Button type="button" variant={autoHeight ? "secondary" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setAutoHeight(true)}>适应窗口</Button>
          <Button type="button" variant={!autoHeight ? "secondary" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setAutoHeight(false)}>自定义高度</Button>
          {!autoHeight && <>
            <label htmlFor="browser-height">网页高度</label>
            <input id="browser-height" type="range" min={420} max={1400} step={10} value={browserHeight} onChange={(event) => setBrowserHeight(Number(event.target.value))} className="h-5 w-36 cursor-pointer accent-primary" aria-valuetext={`${browserHeight} 像素`} />
            <span className="w-14 tabular-nums">{browserHeight} px</span>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setBrowserHeight(650)}>还原</Button>
          </>}
        </div>}
        <p className="w-full text-xs text-muted-foreground">{autoRemember ? `手填内容会自动记住${rememberedCount > 0 ? ` · 本次已记住 ${rememberedCount} 项` : ""}` : "手填内容自动记忆已关闭"} · 记忆库、收藏岗位和进度同步在右上角「更多」中。</p>
      </div>}


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
      {submitted && submitted.tabId === tabsState.activeId && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs">
          <Check className="size-3.5 text-emerald-600" />
          <span>官网显示“{submitted.evidence}”。如果确实提交完成，把它记进投递看板。</span>
          <Button
            type="button"
            size="sm"
            className="h-7"
            onClick={() => {
              setMarkOpen(true);
              setSubmitted(null);
            }}
          >
            <Send className="size-3.5" />
            确认并建档
          </Button>
          <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setSubmitted(null)}>
            不是投递成功
          </button>
        </div>
      )}
      <SiteBanner
        bridge={bridge}
        url={currentUrl}
        title={activeTab?.title ?? ""}
        loading={!!activeTab?.loading}
        sites={knownSites}
        onPickPortalCompany={() => setPortalOpen(true)}
      />
      <div ref={panelRef} role="region" aria-label="网页内容" style={expanded || autoHeight ? undefined : { height: browserHeight }} className={expanded || autoHeight ? "relative min-h-48 flex-1 overflow-hidden rounded-lg border bg-card" : "relative min-h-[26rem] shrink-0 overflow-hidden rounded-lg border bg-card"}>
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

      {(status || capturing) && <div className="shrink-0 rounded-lg border bg-card px-3 py-2 text-xs" role="status">
        {autofilling && status?.phase === "ai" ? <AiProgress active expectedSeconds={30} stages={["基础资料已填，AI 正在生成回答…", "正在从简历中核对信息…", "AI 仍在生成，请稍候…"]} /> : status && <div className="flex items-center gap-2">
          {status.phase === "scanning" && <RotateCw className="size-3.5 shrink-0 animate-spin" />}
          <p className={`min-w-0 flex-1 truncate ${status.phase === "error" ? "text-destructive" : "text-muted-foreground"}`} title={status.message}>
            {status.summary ? `已填 ${status.summary.filled} 项 · 保留 ${status.summary.preserved} 项 · 待手填 ${status.summary.manual} 项${status.summary.excluded ? ` · 范围外 ${status.summary.excluded} 项` : ""}${status.summary.uploaded ? ` · 上传 ${status.summary.uploaded} 份简历` : ""}` : status.message}
          </p>
          {(status.phase === "done" || status.phase === "error") && <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={() => setResultOpen(true)}>查看结果</Button>}
          {!autofilling && <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" aria-label="收起填写结果" onClick={() => { if (activeIdRef.current !== null) tabStatusRef.current.delete(activeIdRef.current); setStatus(null); }}><X className="size-3.5" /></Button>}
        </div>}
        <AiProgress active={capturing} expectedSeconds={15} stages={["正在读页面正文…", "AI 正在解析岗位…"]} />
      </div>}
      <Dialog open={resultOpen} onOpenChange={setResultOpen}>
        <DialogContent className="max-h-[80dvh] overflow-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>填写结果</DialogTitle><DialogDescription>核对已填内容，查看哪些字段需要手填或补充资料。</DialogDescription></DialogHeader>
          <p className="text-sm leading-relaxed">{status?.message}</p>
          {status?.details && <FillDetails details={status.details} />}
          <Button type="button" variant="outline" onClick={() => { setResultOpen(false); router.push("/settings"); }}>补充网申资料</Button>
        </DialogContent>
      </Dialog>

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
        <PositionFormDialog captureMode
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
