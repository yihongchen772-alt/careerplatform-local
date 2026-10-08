"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  ExternalLink,
  FileCode,
  ListChecks,
  Loader2,
  LogOut,
  Maximize2,
  Minus,
  MoreVertical,
  NotebookPen,
  PanelRight,
  PanelRightClose,
  Plus,
  Radar,
  RotateCw,
  ScanSearch,
  Search,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AiProgress } from "@/components/ui/ai-progress";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setToasterPosition } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { parseJd } from "@/lib/actions/jd-parse";
import { PositionFormDialog, type PositionFormInitial } from "@/components/pool/position-form-dialog";
import { PortalSyncDialog, type PortalCompany } from "@/components/browser/portal-sync-dialog";
import { MarkAppliedFromBrowserDialog, type PoolPosition } from "@/components/browser/mark-applied-from-browser";
import { ScreenshotDialog, type ApplicationOption } from "@/components/browser/screenshot-dialog";
import { ApplicationAssistant, panelSelect, type AssistantTab } from "@/components/browser/application-assistant";
import { SiteBanner, type KnownSite } from "@/components/browser/site-banner";
import { TabStrip, useModKey } from "@/components/browser/tab-strip";
import { Omnibox, type QuickLinks } from "@/components/browser/omnibox";
import { Infobar } from "@/components/browser/infobar";
import { NewTabPage } from "@/components/browser/new-tab-page";
import type {
  DesktopBridgeAutofillModule,
  DesktopBridgeAutofillOptions,
  DesktopBridgeAutofillStatus,
  DesktopBridgeHistoryEntry,
  DesktopBridgeTabsState,
} from "@/types/desktop-bridge";

export type { QuickLinks };
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

// Per-device conveniences kept in localStorage; every read tolerates a
// storage that is unavailable.
function readPreference(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}
function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); }
  catch { /* per-device preference only */ }
}
function usePreference(key: string, fallback: string) {
  return useSyncExternalStore(noop, () => readPreference(key, fallback), () => fallback);
}

const FILL_MODULES: { id: DesktopBridgeAutofillModule; label: string }[] = [
  { id: "basic", label: "基本信息 / 求职意向" },
  { id: "education", label: "教育经历" },
  { id: "experience", label: "实习 / 工作经历" },
  { id: "project", label: "项目经历" },
  { id: "award", label: "获奖情况" },
  { id: "questions", label: "开放题 / 自我评价" },
  { id: "other", label: "其他字段" },
  { id: "resume", label: "简历附件" },
];
const ALL_FILL_MODULES = FILL_MODULES.map(({ id }) => id);

function ToolbarIcon({ label, shortcut, className, ...props }: React.ComponentProps<"button"> & { label: string; shortcut?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn("grid size-8 shrink-0 place-items-center rounded-full text-foreground/75 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4", className)}
      {...props}
    />
  );
}

export function EmbeddedBrowser({
  initialUrl, initialPositionId,
  knownSites,
  profileVariants,
  resumeVersions,
  portalCompanies,
  quickLinks,
  poolPositions,
  applications,
}: {
  initialUrl?: string; initialPositionId?: string;
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
  const [status, setStatus] = useState<DesktopBridgeAutofillStatus | null>(null);
  const [autofilling, setAutofilling] = useState(false);
  const [savingCorrections, setSavingCorrections] = useState(false);
  const [pendingChangeCount, setPendingChangeCount] = useState(0);
  const [pageDraftStatus, setPageDraftStatus] = useState({ context: "", message: "" });
  const [jobBindings, setJobBindings] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<DesktopBridgeHistoryEntry[]>([]);
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
  const [markOpen, setMarkOpen] = useState(false);
  const [shotOpen, setShotOpen] = useState(false);
  const [shot, setShot] = useState<{ dataUrl: string; title: string } | null>(null);
  // App-drawn menus and the address suggestions render in the DOM, which
  // the native page view is composited *above* — while any is open the
  // view steps aside and a still of the page stands in for it.
  const [moreOpen, setMoreOpen] = useState(false);
  const [fillMenuOpen, setFillMenuOpen] = useState(false);
  const [omniboxOpen, setOmniboxOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [findResult, setFindResult] = useState<{ active: number; total: number } | null>(null);
  // 资料方案: "" = 跟随简历 (the variant bound to the chosen resume, else the
  // default profile), "default" = always the default, otherwise a variant id.
  const [variantChoice, setVariantChoice] = useState("");
  const scopePreference = useSyncExternalStore(noop, () => {
    try {
      const saved = localStorage.getItem("careerplatform.browser.fillModules.v2");
      if (saved !== null) return saved;
      const old = localStorage.getItem("careerplatform.browser.fillModules");
      return old === null || ALL_FILL_MODULES.filter((id) => id !== "award").every((id) => old.split(",").includes(id)) ? ALL_FILL_MODULES.join(",") : old;
    }
    catch { return ALL_FILL_MODULES.join(","); }
  }, () => ALL_FILL_MODULES.join(","));
  const [scopeOverride, setScopeOverride] = useState<DesktopBridgeAutofillModule[] | null>(null);
  const fillModules = useMemo(() => scopeOverride ?? ALL_FILL_MODULES.filter((id) => scopePreference.split(",").includes(id)), [scopeOverride, scopePreference]);
  function setFillModules(modules: DesktopBridgeAutofillModule[]) {
    const ordered = ALL_FILL_MODULES.filter((id) => modules.includes(id));
    setScopeOverride(ordered);
    writePreference("careerplatform.browser.fillModules.v2", ordered.join(","));
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
  const autoFillPreference = usePreference("careerplatform.browser.autofillEveryPage", "0") === "1";
  const [autoFillOverride, setAutoFillOverride] = useState<boolean | null>(null);
  const autoFill = autoFillOverride ?? autoFillPreference;
  const rememberPreference = usePreference("careerplatform.browser.autoRememberAnswers", "1") !== "0";
  const [rememberOverride, setRememberOverride] = useState<boolean | null>(null);
  const autoRemember = rememberOverride ?? rememberPreference;
  const expandPreference = usePreference("careerplatform.browser.expandBlocks", "0") === "1";
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null);
  const expandBlocks = expandOverride ?? expandPreference;
  const fullWindowPreference = usePreference("careerplatform.browser.expanded", "0") === "1";
  const [fullWindowOverride, setFullWindowOverride] = useState<boolean | null>(null);
  const expanded = fullWindowOverride ?? fullWindowPreference;
  const heightPreference = usePreference("careerplatform.browser.autoHeight", "1") !== "0";
  const [heightOverride, setHeightOverride] = useState<boolean | null>(null);
  const autoHeight = heightOverride ?? heightPreference;
  const panelPreference = usePreference("careerplatform.browser.sidePanel", "0") === "1";
  const [panelOverride, setPanelOverride] = useState<boolean | null>(null);
  const assistantOpen = panelOverride ?? panelPreference;
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("preview");
  // Latest values for the long-lived IPC listener below, updated in an
  // effect (the lint rule forbids touching refs during render).
  const positionId = tabsState.activeId === null ? "" : jobBindings[tabsState.activeId] || "";
  const liveRef = useRef({ positionId, resumeVersionId, autoFill, autofilling, expandBlocks, variantChoice, fillModules });
  useEffect(() => {
    liveRef.current = { positionId, resumeVersionId, autoFill, autofilling, expandBlocks, variantChoice, fillModules };
  }, [positionId, resumeVersionId, autoFill, autofilling, expandBlocks, variantChoice, fillModules]);

  const bridge = useDesktopBridge();
  const mod = useModKey();
  const activeTab = tabsState.tabs.find((t) => t.id === tabsState.activeId) ?? null;
  const currentUrl = activeTab?.url && activeTab.url !== "about:blank" ? activeTab.url : null;
  const draftContext = JSON.stringify([tabsState.activeId, currentUrl, positionId, resumeVersionId, variantChoice]);
  const pageDraftState = pageDraftStatus.context === draftContext ? pageDraftStatus.message : "网页填写草稿等待保存";
  // Overlays from elsewhere in the App (⌘K search, the 小欧 chat panel, any
  // dialog) would also end up hidden behind the page.
  const [appOverlay, setAppOverlay] = useState(false);
  const overlayOpen = captureOpen || portalOpen || markOpen || shotOpen || moreOpen || fillMenuOpen || omniboxOpen || appOverlay;
  const linkedVariant = profileVariants.find((v) => v.resumeVersionId && v.resumeVersionId === resumeVersionId);
  const variantLabel = variantChoice === "" ? `跟随简历（${linkedVariant ? linkedVariant.name : "默认资料"}）` : variantChoice === "default" ? "默认资料" : profileVariants.find((v) => v.id === variantChoice)?.name ?? "默认资料";
  const scopeLabel = fillModules.length === ALL_FILL_MODULES.length ? "全部模块" : fillModules.length === 0 ? "未选择" : fillModules.length === 1 ? FILL_MODULES.find(({ id }) => id === fillModules[0])?.label : `${fillModules.length} 个模块`;
  const resumeName = resumeVersionId ? resumeVersions.find((r) => r.id === resumeVersionId)?.name ?? "简历" : "不用简历";

  function setExpanded(next: boolean) {
    setFullWindowOverride(next);
    writePreference("careerplatform.browser.expanded", next ? "1" : "0");
  }
  function setAutoHeight(next: boolean) {
    setHeightOverride(next);
    writePreference("careerplatform.browser.autoHeight", next ? "1" : "0");
  }
  function openPanel(tab?: AssistantTab) {
    if (tab) setAssistantTab(tab);
    setPanelOverride(true);
    writePreference("careerplatform.browser.sidePanel", "1");
  }
  function closePanel() {
    setPanelOverride(false);
    writePreference("careerplatform.browser.sidePanel", "0");
  }
  function setAutoFillEveryPage(next: boolean) {
    setAutoFillOverride(next);
    writePreference("careerplatform.browser.autofillEveryPage", next ? "1" : "0");
  }
  function setExpandBlocks(next: boolean) {
    setExpandOverride(next);
    writePreference("careerplatform.browser.expandBlocks", next ? "1" : "0");
  }
  function setAutoRememberAnswers(next: boolean) {
    setRememberOverride(next);
    writePreference("careerplatform.browser.autoRememberAnswers", next ? "1" : "0");
  }

  const loadHistory = useCallback(() => {
    window.desktopBridge?.history().then(setHistory).catch(() => {});
  }, []);

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
    const offStatus = bridge.onAutofillStatus((incoming) => {
      const tabId = incoming.tabId ?? activeIdRef.current;
      const previous = tabId === null ? null : tabStatusRef.current.get(tabId);
      const s = (incoming.phase === "scanning" || incoming.phase === "ai") && previous?.plan ? { ...incoming, plan: previous.plan } : incoming;
      if (tabId !== null) {
        tabStatusRef.current.set(tabId, s);
        if (s.phase === "done" || s.phase === "error" || s.phase === "preview") busyTabsRef.current.delete(tabId);
        else busyTabsRef.current.add(tabId);
      }
      if (tabId === activeIdRef.current) {
        setStatus(s);
        setAutofilling(s.phase !== "done" && s.phase !== "error" && s.phase !== "preview");
        if (s.phase === "preview") {
          setAssistantTab("preview");
          setPanelOverride(true);
        }
      }
    });
    const offShortcut = bridge.onShortcut(({ action, tabId }) => {
      if (action === "new-tab") void bridge.newTab();
      else if (action === "close-tab") void bridge.closeTab(tabId);
      else if (action === "focus-address") addressRef.current?.focus();
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
        setStatus({ phase: "scanning", message: `检测到新一页表单（${payload.count} 个字段），自动填写中…` });
        void bridge.autofill(live.resumeVersionId || undefined, { expandBlocks: live.expandBlocks, variantId: live.variantChoice || undefined, modules: live.fillModules, positionId: live.positionId || undefined });
      } else {
        setDetected(payload);
      }
    });
    const offSubmitted = bridge.onApplicationSubmitted((payload) => {
      setSubmitted(payload);
      toast.success(`检测到“${payload.evidence}”，确认后可以记入投递看板`);
    });
    bridge.getTabs().then((state) => { activeIdRef.current = state.activeId; setTabsState(state); if (state.activeId !== null && initialPositionId) setJobBindings((bindings) => ({ ...bindings, [state.activeId!]: initialPositionId })); }).catch(() => {});
    bridge.history().then(setHistory).catch(() => {});
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

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const open = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')).some((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
      });
      setAppOverlay(open);
    };
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(check); });
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    // Toasts go to the top, where the browser's own controls are, not behind the page.
    setToasterPosition("top-center");
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      setToasterPosition(null);
    };
  }, []);

  // A still of the page, taken whenever the pointer comes up to the browser
  // controls, so a menu opened next has a current picture to stand on.
  const [frozen, setFrozen] = useState<{ tabId: number; url: string; src: string } | null>(null);
  const frozenRef = useRef<{ tabId: number; url: string; at: number } | null>(null);
  const framingRef = useRef(false);
  const currentUrlRef = useRef(currentUrl);
  useEffect(() => { currentUrlRef.current = currentUrl; }, [currentUrl]);
  const captureFrame = useCallback(async () => {
    const tabId = activeIdRef.current;
    const url = currentUrlRef.current;
    if (!bridge || tabId === null || !url || framingRef.current) return;
    framingRef.current = true;
    try {
      const src = await bridge.previewFrame();
      if (src) {
        frozenRef.current = { tabId, url, at: Date.now() };
        setFrozen({ tabId, url, src });
      }
    } catch {
      // Without a still the placeholder text shows instead.
    } finally {
      framingRef.current = false;
    }
  }, [bridge]);
  const refreshFrame = useCallback(() => {
    const last = frozenRef.current;
    if (last && last.tabId === activeIdRef.current && last.url === currentUrlRef.current && Date.now() - last.at < 1200) return;
    void captureFrame();
  }, [captureFrame]);

  useEffect(() => {
    if (!bridge || !panelRef.current) return;
    const el = panelRef.current;
    if (overlayOpen) {
      let cancelled = false;
      const last = frozenRef.current;
      const fresh = last && last.tabId === activeIdRef.current && last.url === currentUrlRef.current && Date.now() - last.at < 3000;
      if (fresh || !currentUrlRef.current) bridge.setBounds(null);
      else void captureFrame().finally(() => { if (!cancelled) bridge.setBounds(null); });
      return () => { cancelled = true; };
    }
    const report = () => {
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
  }, [bridge, overlayOpen, captureFrame]);

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
    if (!bridge || !currentUrl || autofilling || savingCorrections) return;
    const timer = window.setInterval(async () => {
      if (autoSavingRef.current) return;
      autoSavingRef.current = true;
      try {
        const { pendingTotal, draftSaved } = await bridge.saveCorrections(resumeVersionId || undefined, true, positionId || "", variantChoice, autoRemember);
        if (pendingTotal !== undefined) setPendingChangeCount(pendingTotal);
        if (draftSaved) setPageDraftStatus({ context: draftContext, message: `${new Date().toLocaleTimeString("zh-CN")} 扫描的网页内容已保存到 App` });
        autoSaveErrorRef.current = false;
      } catch {
        setPageDraftStatus({ context: draftContext, message: "网页草稿保存失败，请保留当前页面并重试" });
        if (!autoSaveErrorRef.current) toast.error("自动检测手填变化失败；可在「⋮」菜单里点「核对本页变化」重试");
        autoSaveErrorRef.current = true;
      } finally {
        autoSavingRef.current = false;
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [bridge, autoRemember, currentUrl, autofilling, savingCorrections, resumeVersionId, positionId, variantChoice, draftContext]);

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
        // ⌘K stays the App's global search; ⌘L is the browser's address bar.
        e.preventDefault();
        addressRef.current?.focus();
      } else if (key === "f") {
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => findRef.current?.select(), 50);
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

  function openUrl(url: string, inNewTab: boolean) {
    if (!bridge) return;
    if (inNewTab || !activeTab) void bridge.newTab(url);
    else void bridge.navigate(url);
  }

  function handleAutofill(extra: DesktopBridgeAutofillOptions = {}) {
    if (!bridge || autofilling) return;
    if (!fillModules.length) { toast.info("请先在「填写范围」里至少勾选一个模块"); return; }
    setDetected(null);
    setAutofilling(true);
    setStatus((old) => ({ phase: "scanning", message: "正在读取页面…", plan: old?.plan }));
    bridge.autofill(resumeVersionId || undefined, { expandBlocks, variantId: variantChoice || undefined, modules: fillModules, positionId: positionId || undefined, ...extra });
  }

  function dismissStatus() {
    if (activeIdRef.current !== null) tabStatusRef.current.delete(activeIdRef.current);
    setStatus(null);
  }

  async function handleSaveCorrections() {
    if (!bridge || savingCorrections) return;
    setSavingCorrections(true);
    try {
      const { pending = 0, pendingTotal, draftSaved, unchanged } = await bridge.saveCorrections(resumeVersionId || undefined, false, positionId || "", variantChoice);
      if (pendingTotal !== undefined) setPendingChangeCount(pendingTotal);
      if (draftSaved) setPageDraftStatus({ context: draftContext, message: `${new Date().toLocaleTimeString("zh-CN")} 扫描的网页内容已保存到 App` });
      if (pending > 0) {
        toast.success(`发现 ${pending} 项可保存内容，已放入账号设置的「待核对变化」`);
      } else {
        toast.info(unchanged ? "这些变化已经在待核对列表中" : "没有发现完整的新内容；未修改的 AI 草稿不会进入待核对列表");
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
      <div className="flex h-[calc(100dvh-6rem)] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        网申浏览器只在桌面版里可用
      </div>
    );
  }

  const zoomPercent = Math.round((activeTab?.zoomFactor ?? 1) * 100);
  const busy = autofilling;
  const fillLabel = fillModules.length === ALL_FILL_MODULES.length ? "一键填写" : "填写所选模块";
  const showFrozen = overlayOpen && !!frozen && frozen.tabId === tabsState.activeId && frozen.url === currentUrl;

  const settingsPanel = (
    <div className="space-y-5 text-xs">
      <section className="space-y-2">
        <h3 className="font-medium text-foreground">简历与资料</h3>
        {resumeVersions.length > 0 ? (
          <label className="block space-y-1">
            <span className="text-muted-foreground">使用简历（AI 答题依据、上传的附件）</span>
            <select aria-label="使用简历" disabled={busy} value={resumeVersionId || "none"} onChange={(e) => setResumeVersionId(e.target.value === "none" ? "" : e.target.value)} className={panelSelect}>
              {resumeVersions.map((r) => <option key={r.id} value={r.id}>{r.name}{r.isDefault ? "（默认）" : ""}</option>)}
              <option value="none">不用简历，只填资料</option>
            </select>
          </label>
        ) : (
          <p className="rounded-md bg-muted/60 p-2 leading-relaxed">还没有可上传的简历。<button type="button" className="text-primary hover:underline" onClick={() => router.push("/resumes")}>去添加简历</button>后，AI 才能回答开放题、自动上传简历附件。</p>
        )}
        {profileVariants.length > 0 && (
          <label className="block space-y-1">
            <span className="text-muted-foreground">资料方案（不同方向的实习/项目顺序和常问字段）</span>
            <select aria-label="资料方案" disabled={busy} value={variantChoice || "auto"} onChange={(e) => setVariantChoice(e.target.value === "auto" ? "" : e.target.value)} className={panelSelect}>
              <option value="auto">跟随简历（{linkedVariant ? linkedVariant.name : "默认资料"}）</option>
              <option value="default">默认资料</option>
              {profileVariants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="text-primary hover:underline" onClick={() => router.push("/settings")}>编辑网申资料 →</button>
      </section>
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="font-medium text-foreground">填写范围</h3>
          <span className="space-x-2">
            <button type="button" className="text-primary hover:underline" onClick={() => setFillModules([...ALL_FILL_MODULES])}>全选</button>
            <button type="button" className="text-primary hover:underline" onClick={() => setFillModules([])}>清空</button>
          </span>
        </div>
        <p className="text-muted-foreground">只补所选模块的空白，已填内容保留；「每页自动填」也按这个范围。</p>
        <div className="grid grid-cols-2 gap-1.5">
          {FILL_MODULES.map(({ id, label }) => (
            <label key={id} className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors", fillModules.includes(id) ? "border-primary/40 bg-primary/5" : "hover:bg-muted")}>
              <input type="checkbox" disabled={busy} checked={fillModules.includes(id)} onChange={(e) => setFillModules(e.target.checked ? [...fillModules, id] : fillModules.filter((item) => item !== id))} />
              <span className="truncate">{label}</span>
            </label>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h3 className="font-medium text-foreground">自动化</h3>
        {[
          { checked: autoFill, set: setAutoFillEveryPage, title: "每页自动填", hint: "网申分好几页时，每翻到一页有空表单就自动填，不用每页点一次。" },
          { checked: expandBlocks, set: setExpandBlocks, title: "自动补齐栏目", hint: "资料里的教育 / 实习 / 项目比页面栏目多时，自动点页面上的「添加」再接着填；只点文字明确的添加按钮，不会点提交。" },
          { checked: autoRemember, set: setAutoRememberAnswers, title: "自动发现待核对变化", hint: "发现你手填或修改的经历与回答，先放进待核对列表；确认前不会用于以后填写。" },
        ].map((item) => (
          <label key={item.title} className="flex items-start gap-2 rounded-md p-1.5 hover:bg-muted">
            <input type="checkbox" className="mt-0.5" checked={item.checked} onChange={(e) => item.set(e.target.checked)} />
            <span><span className="font-medium text-foreground">{item.title}</span><span className="mt-0.5 block leading-relaxed text-muted-foreground">{item.hint}</span></span>
          </label>
        ))}
      </section>
      {!expanded && (
        <section className="space-y-2">
          <h3 className="font-medium text-foreground">网页高度</h3>
          <div className="flex gap-1.5">
            <Button size="xs" variant={autoHeight ? "secondary" : "ghost"} onClick={() => setAutoHeight(true)}>适应窗口</Button>
            <Button size="xs" variant={!autoHeight ? "secondary" : "ghost"} onClick={() => setAutoHeight(false)}>自定义高度</Button>
          </div>
          {!autoHeight && (
            <div className="flex items-center gap-2">
              <input aria-label="网页高度" type="range" min={420} max={1400} step={10} value={browserHeight} onChange={(event) => setBrowserHeight(Number(event.target.value))} className="h-5 flex-1 cursor-pointer accent-primary" aria-valuetext={`${browserHeight} 像素`} />
              <span className="w-14 text-right tabular-nums">{browserHeight} px</span>
              <Button size="xs" variant="ghost" onClick={() => setBrowserHeight(650)}>还原</Button>
            </div>
          )}
        </section>
      )}
      <section className="space-y-2">
        <h3 className="font-medium text-foreground">本页记录</h3>
        <p className="leading-relaxed text-muted-foreground">{currentUrl ? pageDraftState : "打开网申页面后，填写内容会自动保存为草稿。"}{autoRemember ? "" : " · 自动发现已关闭，草稿仍自动保存"}</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" disabled={savingCorrections || busy || !currentUrl} onClick={handleSaveCorrections}><Check />{savingCorrections ? "检测中…" : "核对本页变化"}</Button>
          <Button size="xs" variant="ghost" onClick={() => router.push("/settings#pending-application-changes")}><NotebookPen />待核对变化{pendingChangeCount ? `（${pendingChangeCount}）` : ""}</Button>
        </div>
      </section>
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-muted dark:bg-background",
        expanded ? "fixed inset-0 z-[45]" : "rounded-xl border shadow-[0_1px_3px_rgb(0_0_0/0.06),0_8px_24px_-12px_rgb(0_0_0/0.18)]",
        !expanded && autoHeight && "h-[calc(100dvh-6rem)] min-h-[26rem]"
      )}
    >
      <div className="flex shrink-0 flex-col" onPointerEnter={refreshFrame}>
        <TabStrip
          tabs={tabsState.tabs}
          activeId={tabsState.activeId}
          expanded={expanded}
          onSwitch={(id) => void bridge.switchTab(id)}
          onClose={(id) => void bridge.closeTab(id)}
          onNew={() => void bridge.newTab().then(() => setTimeout(() => addressRef.current?.focus(), 80))}
          onToggleExpanded={() => setExpanded(!expanded)}
        />

        {/* toolbar */}
        <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-card px-2">
          <ToolbarIcon label="后退" shortcut={`${mod}[`} disabled={!activeTab?.canGoBack} onClick={() => bridge.back()}><ArrowLeft /></ToolbarIcon>
          <ToolbarIcon label="前进" shortcut={`${mod}]`} disabled={!activeTab?.canGoForward} onClick={() => bridge.forward()}><ArrowRight /></ToolbarIcon>
          <ToolbarIcon label={activeTab?.loading ? "停止加载" : "重新加载"} shortcut={activeTab?.loading ? undefined : `${mod}R`} disabled={!currentUrl} onClick={() => (activeTab?.loading ? bridge.stop() : bridge.reload())}>
            {activeTab?.loading ? <X /> : <RotateCw />}
          </ToolbarIcon>
          <div className="mx-1 min-w-0 flex-1">
            <Omnibox
              url={currentUrl}
              links={quickLinks}
              history={history}
              zoomPercent={zoomPercent}
              capturing={capturing}
              inputRef={addressRef}
              onNavigate={openUrl}
              onOpenChange={setOmniboxOpen}
              onZoomReset={() => bridge.zoomReset()}
              onBookmark={handleCapture}
              onFocusRequestHistory={loadHistory}
            />
          </div>

          {pendingChangeCount > 0 && (
            <button type="button" onClick={() => router.push("/settings#pending-application-changes")} title="你在网页上手填或修改的内容，确认后才会用于以后填写" className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-amber-500/12 px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400">
              <NotebookPen className="size-3.5" />待核对 {pendingChangeCount}
            </button>
          )}

          {busy ? (
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => void bridge.cancelAutofill(tabsState.activeId ?? undefined)} title="停止填写，已填入的内容保留">
              <Loader2 className="animate-spin" />填写中 · 停止
            </Button>
          ) : (
            <div className="flex shrink-0 items-center">
              <Button
                size="sm"
                className="rounded-r-none pr-2.5"
                disabled={!currentUrl || !fillModules.length}
                onClick={() => handleAutofill()}
                title={`仅补空白字段，已填内容保留\n简历：${resumeName} · 范围：${scopeLabel}`}
              >
                <Sparkles />
                {fillLabel}
              </Button>
              <DropdownMenu open={fillMenuOpen} onOpenChange={setFillMenuOpen}>
                <DropdownMenuTrigger render={<Button size="sm" className="rounded-l-none border-l border-l-white/25 px-1.5" aria-label="填写选项" title="简历、填写范围和自动化选项" />}>
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>使用简历</DropdownMenuLabel>
                    {resumeVersions.length > 0 ? (
                      <DropdownMenuRadioGroup value={resumeVersionId || "none"} onValueChange={(value) => setResumeVersionId(value === "none" ? "" : String(value))}>
                        {resumeVersions.map((r) => <DropdownMenuRadioItem key={r.id} value={r.id}>{r.name}{r.isDefault ? "（默认）" : ""}</DropdownMenuRadioItem>)}
                        <DropdownMenuRadioItem value="none">不用简历，只填资料</DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    ) : (
                      <DropdownMenuItem onClick={() => router.push("/resumes")}><Plus />添加简历…</DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  {profileVariants.length > 0 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger><span className="truncate">资料方案：{variantLabel}</span></DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-56">
                        <DropdownMenuRadioGroup value={variantChoice || "auto"} onValueChange={(value) => setVariantChoice(value === "auto" ? "" : String(value))}>
                          <DropdownMenuRadioItem value="auto">跟随简历</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="default">默认资料</DropdownMenuRadioItem>
                          {profileVariants.map((v) => <DropdownMenuRadioItem key={v.id} value={v.id}>{v.name}</DropdownMenuRadioItem>)}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger><span className="truncate">填写范围：{scopeLabel}</span></DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56">
                      <DropdownMenuItem closeOnClick={false} onClick={() => setFillModules([...ALL_FILL_MODULES])}>全选</DropdownMenuItem>
                      <DropdownMenuItem closeOnClick={false} onClick={() => setFillModules([])}>清空</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {FILL_MODULES.map(({ id, label }) => (
                        <DropdownMenuCheckboxItem key={id} closeOnClick={false} checked={fillModules.includes(id)} onCheckedChange={(checked) => setFillModules(checked ? [...fillModules, id] : fillModules.filter((item) => item !== id))}>
                          {label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem closeOnClick={false} checked={autoFill} onCheckedChange={(checked) => setAutoFillEveryPage(!!checked)}>每页自动填</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem closeOnClick={false} checked={expandBlocks} onCheckedChange={(checked) => setExpandBlocks(!!checked)}>自动补齐栏目</DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={!currentUrl} onClick={() => { openPanel("preview"); handleAutofill({ mode: "preview", answerLength: 200 }); }}><ScanSearch />逐字段预览后再填…</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openPanel("settings")}><Settings2 />全部填写设置…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <ToolbarIcon
            label={assistantOpen ? "关闭填写助手" : "打开填写助手（侧边栏）"}
            onClick={() => (assistantOpen ? closePanel() : openPanel())}
            className={cn(assistantOpen && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}
          >
            {assistantOpen ? <PanelRightClose /> : <PanelRight />}
          </ToolbarIcon>

          <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
            <DropdownMenuTrigger render={<ToolbarIcon label="更多" />}>
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => void bridge.newTab().then(() => setTimeout(() => addressRef.current?.focus(), 80))}><Plus />新建标签页<DropdownMenuShortcut>{mod}T</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="flex items-center gap-1 px-1.5 py-1 text-sm">
                <span className="flex-1">缩放</span>
                <button type="button" aria-label="缩小网页" disabled={!currentUrl} onClick={() => bridge.zoomOut()} className="grid size-7 place-items-center rounded-md hover:bg-muted disabled:opacity-40"><Minus className="size-4" /></button>
                <button type="button" title="还原为 100%" disabled={!currentUrl} onClick={() => bridge.zoomReset()} className="h-7 w-12 rounded-md text-center text-xs tabular-nums hover:bg-muted disabled:opacity-40">{zoomPercent}%</button>
                <button type="button" aria-label="放大网页" disabled={!currentUrl} onClick={() => bridge.zoomIn()} className="grid size-7 place-items-center rounded-md hover:bg-muted disabled:opacity-40"><Plus className="size-4" /></button>
                <button type="button" aria-label="全屏浏览" title={expanded ? "退出全屏浏览" : "全屏浏览"} onClick={() => { setMoreOpen(false); setExpanded(!expanded); }} className="ml-1 grid size-7 place-items-center rounded-md border hover:bg-muted"><Maximize2 className="size-3.5" /></button>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!currentUrl} onClick={() => { setFindOpen(true); setTimeout(() => findRef.current?.select(), 50); }}><Search />在页面中查找…<DropdownMenuShortcut>{mod}F</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled={capturing || !currentUrl} onClick={handleCapture}><Bookmark />收藏为候选岗位</DropdownMenuItem>
              <DropdownMenuItem disabled={!currentUrl} onClick={() => setMarkOpen(true)}><Send />记为已投递…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPortalOpen(true)}><Radar />设置进度同步…</DropdownMenuItem>
              <DropdownMenuItem disabled={!currentUrl} onClick={handleScreenshot}><Camera />截图存到投递附件…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={savingCorrections || busy || !currentUrl} onClick={handleSaveCorrections}><Check />{savingCorrections ? "检测中…" : "核对本页变化"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/settings#pending-application-changes")}><NotebookPen />打开待核对变化{pendingChangeCount ? `（${pendingChangeCount}）` : ""}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => bridge.clearMarks()}><Eraser />清除填写标记</DropdownMenuItem>
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
                <FileCode />导出表单结构（反馈填错用）
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!currentUrl} onClick={() => bridge.openExternal()}><ExternalLink />在系统浏览器中打开</DropdownMenuItem>
              <DropdownMenuItem disabled={!currentUrl} onClick={() => { void bridge.copyUrl(); toast.success("链接已复制"); }}><Copy />复制链接</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => { await bridge.clearHistory(); setHistory([]); toast.success("最近访问已清空"); }}><Trash2 />清空最近访问</DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={async () => {
                  if (!window.confirm("会清掉网申浏览器里所有网站的登录状态和缓存（不影响 App 自己的数据），确定？")) return;
                  await bridge.clearSiteData();
                  toast.success("已退出所有网站登录");
                }}
              >
                <LogOut />退出所有网站登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {findOpen && (
          <div className="flex h-9 shrink-0 items-center justify-end gap-1.5 border-b bg-card px-3">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              ref={findRef}
              value={findText}
              aria-label="在页面中查找"
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
              placeholder="在页面中查找"
              className="h-7 w-56 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <span className="w-14 text-center text-xs text-muted-foreground tabular-nums">
              {findText ? (findResult ? `${findResult.active}/${findResult.total}` : "…") : ""}
            </span>
            <ToolbarIcon label="上一个" className="size-7" disabled={!findText} onClick={() => runFind(findText, false, true)}><ChevronUp /></ToolbarIcon>
            <ToolbarIcon label="下一个" className="size-7" disabled={!findText} onClick={() => runFind(findText, true, true)}><ChevronDown /></ToolbarIcon>
            <ToolbarIcon label="关闭查找" className="size-7" onClick={closeFind}><X /></ToolbarIcon>
          </div>
        )}

        {status && (status.phase === "scanning" || status.phase === "ai") && busy && (
          <Infobar
            tone="info"
            icon={<Loader2 className="animate-spin" />}
            actions={<Button size="xs" variant="outline" onClick={() => void bridge.cancelAutofill(tabsState.activeId ?? undefined)}>停止填写</Button>}
          >
            {status.phase === "ai" ? (
              <AiProgress active expectedSeconds={30} stages={["基础资料已填，AI 正在生成回答…", "正在从简历中核对信息…", "AI 仍在生成，请稍候…"]} />
            ) : (
              <span className="text-muted-foreground">{status.message}</span>
            )}
          </Infobar>
        )}
        {status && (status.phase === "done" || status.phase === "error") && (
          <Infobar
            tone={status.phase === "error" ? "danger" : status.summary?.manual ? "warning" : "success"}
            icon={status.phase === "error" ? <TriangleAlert /> : status.summary?.manual ? <ListChecks /> : <Check />}
            onClose={dismissStatus}
            closeLabel="收起填写结果"
            actions={status.details?.length ? <Button size="xs" variant="outline" onClick={() => openPanel("result")}>{status.summary?.manual ? "查看待手填" : "查看结果"}</Button> : undefined}
          >
            <span title={status.message}>
              {status.summary
                ? `已填 ${status.summary.filled} 项 · 保留原有 ${status.summary.preserved} 项 · 待手填 ${status.summary.manual} 项${status.summary.excluded ? ` · 范围外 ${status.summary.excluded} 项` : ""}${status.summary.uploaded ? ` · 上传 ${status.summary.uploaded} 份简历` : ""}。提交前请核对网页上的紫色框。`
                : status.message}
            </span>
          </Infobar>
        )}
        {capturing && (
          <Infobar tone="info" icon={<Loader2 className="animate-spin" />}>
            <AiProgress active expectedSeconds={15} stages={["正在读页面正文…", "AI 正在解析岗位…"]} />
          </Infobar>
        )}
        {detected && !busy && detected.tabId === tabsState.activeId && (
          <Infobar
            tone="info"
            icon={<Sparkles />}
            onClose={() => {
              void bridge.dismissForm({ tabId: detected.tabId, signature: detected.signature });
              setDetected(null);
            }}
            closeLabel="这页不用填"
            actions={<>
              <label className="mr-1 flex items-center gap-1.5 text-muted-foreground">
                <input type="checkbox" checked={autoFill} onChange={(e) => setAutoFillEveryPage(e.target.checked)} />
                以后每一页自动填
              </label>
              <Button size="xs" onClick={() => handleAutofill()}><Sparkles />填这页</Button>
            </>}
          >
            这页有 {detected.count} 个可以自动填写的字段。
          </Infobar>
        )}
        {submitted && submitted.tabId === tabsState.activeId && (
          <Infobar
            tone="success"
            icon={<Check />}
            onClose={() => setSubmitted(null)}
            closeLabel="不是投递成功"
            actions={<Button size="xs" onClick={() => { setMarkOpen(true); setSubmitted(null); }}><Send />确认并建档</Button>}
          >
            官网显示“{submitted.evidence}”。如果确实提交完成了，把它记进投递看板。
          </Infobar>
        )}
        <SiteBanner
          bridge={bridge}
          url={currentUrl}
          title={activeTab?.title ?? ""}
          loading={!!activeTab?.loading}
          sites={knownSites}
          onPickPortalCompany={() => setPortalOpen(true)}
        />
      </div>

      <div className={cn("flex min-h-0 overflow-hidden", (expanded || autoHeight) && "flex-1")}>
        <div
          ref={panelRef}
          role="region"
          aria-label="网页内容"
          style={expanded || autoHeight ? undefined : { height: browserHeight }}
          className={cn("relative min-w-0 flex-1 overflow-hidden bg-white", !(expanded || autoHeight) && "min-h-[26rem]")}
        >
          {!currentUrl && !overlayOpen && (
            <NewTabPage
              links={quickLinks}
              history={history}
              onOpen={openUrl}
              onFocusAddress={() => addressRef.current?.focus()}
            />
          )}
          {showFrozen && (
            // The page's own pixels, a moment old, while App menus cover it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frozen.src} alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover object-left-top" />
          )}
          {overlayOpen && currentUrl && !showFrozen && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">关掉菜单或弹窗后网页就会回来</p>
          )}
        </div>

        {assistantOpen && (
          <div className="flex shrink-0" onPointerEnter={refreshFrame}>
            <ApplicationAssistant
              key={activeTab?.id ?? "none"}
              bridge={bridge}
              status={status}
              busy={busy}
              resumeId={resumeVersionId}
              variantId={variantChoice}
              positionId={positionId}
              tab={assistantTab}
              onTab={setAssistantTab}
              onClose={closePanel}
              onPosition={(id) => { if (activeTab) setJobBindings((bindings) => ({ ...bindings, [activeTab.id]: id })); setStatus(null); }}
              onPreview={(extra) => handleAutofill({ mode: "preview", ...extra })}
              onApply={(options) => handleAutofill(options)}
              settings={settingsPanel}
              onOpenProfile={() => router.push("/settings")}
            />
          </div>
        )}
      </div>

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
          initialPositionId={positionId || undefined}
          initialResumeId={resumeVersionId || undefined}
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
