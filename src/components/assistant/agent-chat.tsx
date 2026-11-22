"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Check, Plus, Loader2, CircleAlert, CircleCheck, Trash2, Copy, MessageSquareText, ChevronRight, Square, RotateCcw, Pencil, ArrowDown, ImagePlus, Camera, X, Brain, StickyNote, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { applyAssistantAction } from "@/lib/actions/assistant";
import { createNoteWithContent } from "@/lib/actions/productivity";
import { addAgentMemory, deleteAgentMemory, getAgentState, saveAgentPlan, type AgentState } from "@/lib/actions/agent-memory";
import { deleteAgentConversation, listAgentConversations, loadAgentConversation, saveAgentConversation, type AgentThreadSummary } from "@/lib/actions/agent-conversation";
import { assistantActionSchema, type AssistantAction, type AssistantChatMessage } from "@/lib/assistant-shared";
import { STAGE_LABELS } from "@/lib/stage-labels";
import type { AgentStep } from "@/lib/agent/run";
import { AGENT_MODE_LIST, AGENT_MODE_MAP, type AgentMode } from "@/lib/agent/modes";
import { VoiceInput } from "./voice-input";
import { MarkdownText } from "./markdown-text";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/copy-text";
import { launchBatchApply } from "@/lib/batch-apply";

export type ChatImageAttachment = {
  dataUrl: string;
  mimeType: string;
  name?: string;
};

type DisplayMessage = AssistantChatMessage & {
  id: number;
  /** Session-only image thumbnails sent with this user turn (not stored in SQLite). */
  images?: ChatImageAttachment[];
  actions?: AssistantAction[];
  /** Indices of this message's actions already applied, so they don't run twice. */
  applied?: number[];
  steps?: AgentStep[];
  /** Collapsible model reasoning summary captured during this turn (session-only). */
  thought?: string;
  /** Backup models used this turn ("…过载，改用 …"). */
  notices?: string[];
  failedRequest?: { message: string; history: AssistantChatMessage[] };
  /** Answers drafted for the open page's questions (「填进这一栏」), and which went in. */
  drafts?: PageDraft[];
  filled?: number[];
};

const MAX_ATTACH_IMAGES = 4;

/** Compresses a pasted/picked image into a compact JPEG/WebP dataUrl (max 1400px edge). */
async function compressImageFile(file: Blob, name?: string): Promise<ChatImageAttachment> {
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
  return compressDataUrl(rawUrl, file.type || "image/png", name);
}

async function compressDataUrl(rawUrl: string, fallbackMime = "image/png", name?: string): Promise<ChatImageAttachment> {
  if (typeof window === "undefined" || typeof Image === "undefined") {
    return { dataUrl: rawUrl, mimeType: fallbackMime, name };
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("图片解析失败"));
    el.src = rawUrl;
  });
  const maxEdge = 1400;
  const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl: rawUrl, mimeType: fallbackMime, name };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const compressed = canvas.toDataURL("image/jpeg", 0.84);
  return { dataUrl: compressed, mimeType: "image/jpeg", name };
}

export type PageDraft = { question: string; answer: string; section?: string };

export type AgentPageField = {
  label: string;
  section?: string;
  tag?: string;
  type?: string;
  required?: boolean;
  filled?: boolean;
  value?: string;
  options?: string[];
  maxLength?: number;
  validationError?: string;
};

/** The 网申 page open beside 小欧 (网申浏览器's side panel). */
export type AgentPageContext = {
  url: string;
  title: string;
  text: string;
  questions: { label: string; value: string }[];
  formFields?: AgentPageField[];
  uploadSlots?: { label: string; fileKind?: string; uploaded: boolean }[];
  jdPage?: { url: string; title: string; text: string } | null;
  positionId?: string;
  contextKey?: string;
  portalCompanyId?: string;
  portalCompanyName?: string;
  portalAlreadySet?: boolean;
  preflight?: {
    requiredMissing?: number;
    validationErrors?: number;
    conflicts?: number;
    shortened?: number;
    reviewCount?: number;
    uploaded?: number;
  };
  eligibilityWarnings?: string[];
};

type TurnResult =
  | { ok: true; reply: string; actions: AssistantAction[]; drafts: PageDraft[]; steps: AgentStep[]; notices: string[]; refs: string }
  | { ok: false; message: string; aborted?: boolean };

const DESTRUCTIVE_ACTIONS = new Set<AssistantAction["type"]>([
  "delete_position",
  "withdraw_application",
  "delete_task",
  "delete_contact",
]);

function actionMetaChips(action: AssistantAction): string[] {
  const chips: string[] = [];
  if (action.companyName || action.title) {
    chips.push([action.companyName, action.title].filter(Boolean).join(" · "));
  }
  if (action.stage && action.stage in STAGE_LABELS) {
    chips.push(STAGE_LABELS[action.stage as keyof typeof STAGE_LABELS]);
  }
  if (action.city) chips.push(action.city);
  if (action.date) chips.push(action.dateEnd ? `${action.date} ~ ${action.dateEnd}` : action.date);
  if (action.salaryMin != null || action.salaryMax != null) {
    chips.push(`${action.salaryMin ?? "?"}-${action.salaryMax ?? "?"}K`);
  }
  if (action.offerAnnualTotal != null) chips.push(`总包 ${action.offerAnnualTotal}万`);
  return chips.slice(0, 4);
}
type Tab = "chat" | "history" | "plan" | "memory";

/** Where the chat lived before it was kept in the database (moved over once). */
const LEGACY_HISTORY_KEY = "careerplatform-agent-history-v1";
/** A thread touched this recently is picked up again when 小欧 opens. */
const RESUME_WITHIN_MS = 12 * 3_600_000;
const isRecent = (iso: string) => Date.now() - new Date(iso).getTime() < RESUME_WITHIN_MS;

// Derived from the href itself rather than step.tool: prepare_application
// returns href: "/pool" (agent-tools.ts) when the position has no usable
// entry link at all, and labeling that link "打开网申入口" would be wrong —
// there's nothing to open, it's just a pointer back to the candidate pool.
function hrefLinkLabel(href: string): string {
  if (href.startsWith("/browser")) return "继续准备 / 打开网申入口";
  if (href.startsWith("/resumes")) return "查看简历";
  if (href.startsWith("/pool")) return "查看候选池";
  if (href.startsWith("/applications/")) return "查看这条投递";
  return "查看详情";
}

// Written as things a student in the middle of 秋招 actually says, not as
// feature names — the last one teaches that 小欧 turns "I did X" into records.
export const DEFAULT_SUGGESTIONS = [
  "帮我规划这周：先做什么、投哪些、准备哪场面试",
  "比较一下我候选池里最值得投的几个岗位，给个结论",
  "按我的方向和意向城市，去官网找几个新岗位",
  "我刚面完腾讯二面，问了项目难点和一道 SQL，帮我记下来",
];

/** One tap, any time — the questions asked most during 秋招. */
export const DEFAULT_QUICK_QUESTIONS = ["今天有什么安排？", "帮我规划这周", "帮我准备下一场面试", "哪些该跟进了？", "帮我找新岗位"];

function StepLine({ step, onNavigate }: { step: AgentStep; onNavigate?: () => void }) {
  const Icon = step.status === "running" ? Loader2 : step.status === "error" ? CircleAlert : CircleCheck;
  return (
    <li className="relative pb-2 pl-5 last:pb-0 before:absolute before:top-[18px] before:bottom-0.5 before:left-[6.5px] before:w-px before:bg-border last:before:hidden">
      <Icon className={`absolute top-0.5 left-0 size-3.5 ${step.status === "running" ? "animate-spin text-muted-foreground" : step.status === "error" ? "text-destructive" : "text-green-600"}`} />
      <div className="min-w-0">
        <p className={step.status === "error" ? "text-destructive" : "text-foreground"}>{step.label}</p>
        {step.summary && <p className="text-muted-foreground">{step.summary}</p>}
        {step.href && <Link href={step.href} onClick={onNavigate} className="text-primary underline">{hrefLinkLabel(step.href)}</Link>}
      </div>
    </li>
  );
}

/** "做了 N 步" — folded by default, opens into the step timeline. */
function StepsSummary({ steps, onNavigate }: { steps: AgentStep[]; onNavigate?: () => void }) {
  const failed = steps.filter((step) => step.status === "error").length;
  return (
    <details className="group/steps px-1 text-xs">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        {failed ? <CircleAlert className="size-3.5 text-destructive" /> : <CircleCheck className="size-3.5 text-green-600" />}
        做了 {steps.length} 步{failed ? `（${failed} 步没成）` : ""}
        <ChevronRight className="size-3.5 transition-transform group-open/steps:rotate-90" />
      </summary>
      <ol className="mt-2">{steps.map((step) => <StepLine key={step.id} step={step} onNavigate={onNavigate} />)}</ol>
    </details>
  );
}

/** Reads the agent's NDJSON stream; `onEvent` sees each step as it happens. */
async function streamTurn(
  message: string,
  history: AssistantChatMessage[],
  page: AgentPageContext | null,
  routeContext: { pathname: string } | undefined,
  images: ChatImageAttachment[] | undefined,
  mode: AgentMode,
  thinking: "auto" | "deep",
  signal: AbortSignal,
  onEvent: (event: { type: string; step?: AgentStep; text?: string; mode?: string; thinking?: string }) => void
): Promise<TurnResult> {
  const response = await fetch("/api/agent", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      mode,
      thinking,
      ...(images?.length ? { images } : {}),
      ...(page ? { page } : {}),
      ...(routeContext ? { routeContext } : {}),
    }),
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    return { ok: false, message: body?.error ?? "小欧暂时连不上，请稍后重试" };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "done") return { ok: true, reply: event.reply, actions: event.actions ?? [], drafts: event.drafts ?? [], steps: event.steps ?? [], notices: event.notices ?? [], refs: typeof event.refs === "string" ? event.refs : "" };
        if (event.type === "error") return { ok: false, message: event.message };
        onEvent(event);
      }
      if (done) return { ok: false, message: "连接中断，本次请求未完成。请稍后重试。" };
    }
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => {});
  }
}

function toDisplay(stored: Array<Record<string, unknown>>, keepActions: boolean): DisplayMessage[] {
  return stored.map((m, id) => {
    const storedApplied = Array.isArray(m.applied) ? (m.applied as number[]) : [];
    // Actions that no longer parse are dropped, so `applied` (positions in the
    // stored list) is re-pointed at the kept ones — otherwise a later action
    // would show 已保存 without being saved, or a saved one could save twice.
    const kept = keepActions && Array.isArray(m.actions) ? m.actions.map((item, index) => ({ index, parsed: assistantActionSchema.safeParse(item) })).filter((item) => item.parsed.success) : undefined;
    const actions = kept?.map((item) => item.parsed.data!);
    const applied = kept ? kept.flatMap((item, at) => (storedApplied.includes(item.index) ? [at] : [])) : storedApplied;
    return {
      id, role: m.role as "user" | "assistant", content: String(m.content ?? ""), refs: typeof m.refs === "string" ? m.refs : undefined, actions, applied,
      steps: Array.isArray(m.steps) ? (m.steps as AgentStep[]) : undefined, notices: Array.isArray(m.notices) ? (m.notices as string[]) : undefined,
      failedRequest: m.failedRequest as DisplayMessage["failedRequest"],
      drafts: Array.isArray(m.drafts) ? (m.drafts as PageDraft[]) : undefined, filled: Array.isArray(m.filled) ? (m.filled as number[]) : [],
    };
  });
}

function toStored(messages: DisplayMessage[]) {
  return messages.map(({ role, content, refs, actions, applied, steps, notices, failedRequest, drafts, filled }) => ({
    role,
    ...(refs ? { refs: refs.slice(0, 4000) } : {}),
    ...(drafts?.length
      ? {
          drafts: drafts.slice(0, 40).map((d) => ({
            question: d.question.slice(0, 500),
            answer: d.answer.slice(0, 6000),
            ...(d.section ? { section: d.section.slice(0, 80) } : {}),
          })),
          filled: (filled ?? []).filter((idx) => idx >= 0 && idx < 40).slice(0, 40),
        }
      : {}),
    content: content.slice(0, 16000),
    ...(actions?.length ? { actions: actions.slice(0, 30) } : {}),
    ...(applied?.length ? { applied: applied.filter((idx) => idx >= 0 && idx < 30).slice(0, 30) } : {}),
    ...(steps?.length ? { steps: steps.slice(0, 60).map((step) => ({ ...step, label: step.label.slice(0, 300), summary: step.summary.slice(0, 400) })) } : {}),
    ...(notices?.length ? { notices: notices.slice(0, 12).map((n) => n.slice(0, 300)) } : {}),
    ...(failedRequest ? { failedRequest: { message: failedRequest.message.slice(0, 6000), history: failedRequest.history.slice(-20) } } : {}),
  }));
}

function when(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  return date.toDateString() === today.toDateString() ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/**
 * 小欧's conversation, plan and memory — the floating window on every page
 * and the 网申浏览器's side panel (with the open page as context) both show this.
 */
export function AgentChat({ header, pageContext, routeContext, captureBrowserScreenshot, suggestions = DEFAULT_SUGGESTIONS, quickQuestions = DEFAULT_QUICK_QUESTIONS, intro, askText, askSend = false, askMode, onAskConsumed, onNavigate, onReply, onFillField, onFillFields, className }: {
  header: ReactNode;
  pageContext?: () => Promise<AgentPageContext | null>;
  routeContext?: { pathname: string };
  /** 网申浏览器 only: captures current page screenshot so 小欧 can inspect visually. */
  captureBrowserScreenshot?: () => Promise<{ dataUrl: string; title?: string } | null>;
  suggestions?: string[];
  quickQuestions?: string[];
  intro?: ReactNode;
  /** A question typed in from elsewhere (「接着问小欧」). */
  askText?: string | null;
  /** Send askText as soon as the chat is ready instead of only typing it in. */
  askSend?: boolean;
  /** Optional expert mode to switch into when consuming askText. */
  askMode?: AgentMode;
  onAskConsumed?: () => void;
  onNavigate?: () => void;
  /** A turn finished (answered or failed) — for a dot when the panel is closed. */
  onReply?: () => void;
  /** 网申浏览器 only: writes a drafted answer into the page box with that question. */
  onFillField?: (draft: PageDraft) => Promise<boolean>;
  /** 网申浏览器 only: batch writes drafted answers and returns filled draft indices. */
  onFillFields?: (drafts: PageDraft[]) => Promise<number[]>;
  className?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("chat");
  const [mode, setModeState] = useState<AgentMode>("general");
  const modeRef = useRef<AgentMode>("general");
  const setMode = (next: AgentMode) => {
    modeRef.current = next;
    setModeState(next);
  };
  const [deepThinking, setDeepThinking] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<AgentThreadSummary[] | null>(null);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [capturingShot, setCapturingShot] = useState(false);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<{ steps: AgentStep[]; note: string; text: string; thought: string; thinkingLevel?: string }>({ steps: [], note: "", text: "", thought: "" });
  const [applying, setApplying] = useState<string | null>(null);
  const [state, setState] = useState<AgentState | null>(null);
  const [planDraft, setPlanDraft] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const nextId = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const liveTextRef = useRef("");
  const liveThoughtRef = useRef("");
  const liveStepsRef = useRef<AgentStep[]>([]);
  const busyRef = useRef(false);
  const threadRef = useRef<string | null>(null);
  const dirty = useRef(false);
  // Bumped by 新对话 / opening a thread: a save still on its way for the
  // previous thread must not bind the new one to that thread's id.
  const generation = useRef(0);

  useEffect(() => { threadRef.current = threadId; }, [threadId]);

  // Auto-grow composer textarea up to 140px.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  // The latest thread is picked up when it is recent; an old chat kept in
  // localStorage moves into the database once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY) ?? "null");
        if (Array.isArray(legacy) && legacy.length) {
          const kept = legacy.filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string").slice(-60).map((m) => ({ role: m.role, content: m.content.slice(0, 16000) }));
          if (kept.length) await saveAgentConversation({ messages: kept });
        }
        localStorage.removeItem(LEGACY_HISTORY_KEY);
      } catch { /* Old local history is optional. */ }
      const res = await loadAgentConversation();
      if (cancelled) return;
      if (res.ok && res.data && isRecent(res.data.updatedAt)) {
        const restored = toDisplay(res.data.messages, true);
        setMessages(restored);
        nextId.current = restored.length;
        setThreadId(res.data.id);
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Saved shortly after each change, once the turn is over.
  useEffect(() => {
    if (!loaded || sending || !messages.length || !dirty.current) return;
    const timer = setTimeout(async () => {
      dirty.current = false;
      const started = generation.current;
      const res = await saveAgentConversation({ id: threadRef.current, messages: toStored(messages) });
      if (res.ok && generation.current === started) {
        threadRef.current = res.data.id;
        setThreadId(res.data.id);
      } else if (!res.ok) {
        toast.error(res.message || "对话保存失败，请稍后重试");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, loaded, sending]);

  useEffect(() => {
    if (tab === "chat" && stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: live.text ? "auto" : "smooth", block: "end" });
    }
  }, [messages, live, sending, tab]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    stickToBottomRef.current = nearBottom;
    setShowScrollDown(!nearBottom);
  }

  function scrollToBottom() {
    stickToBottomRef.current = true;
    setShowScrollDown(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  const loadThreads = useCallback(async () => {
    const res = await listAgentConversations();
    if (res.ok) setThreads(res.data);
    else toast.error(res.message);
  }, []);

  function openTab(next: Tab) {
    setTab(next);
    setPlanDraft(null);
    if (next === "plan" || next === "memory") void getAgentState().then((res) => (res.ok ? setState(res.data) : toast.error(res.message)));
    if (next === "history") void loadThreads();
  }

  function update(next: (prev: DisplayMessage[]) => DisplayMessage[]) {
    dirty.current = true;
    setMessages(next);
  }

  function addMessage(role: "user" | "assistant", content: string, actions?: AssistantAction[], steps?: AgentStep[], notices?: string[], drafts?: PageDraft[], refs?: string, images?: ChatImageAttachment[], thought?: string) {
    const id = nextId.current++;
    update((prev) => [...prev, { id, role, content, ...(images?.length ? { images } : {}), ...(thought ? { thought } : {}), ...(refs ? { refs } : {}), actions, steps, notices, applied: [], drafts: drafts?.length ? drafts : undefined, filled: [] }]);
  }

  async function attachImageFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    const room = Math.max(0, MAX_ATTACH_IMAGES - pendingImages.length);
    if (!room) {
      toast.error(`单次最多附带 ${MAX_ATTACH_IMAGES} 张图片`);
      return;
    }
    const added: ChatImageAttachment[] = [];
    for (const file of list.slice(0, room)) {
      try {
        added.push(await compressImageFile(file, file.name));
      } catch {
        toast.error(`读取图片「${file.name || "截图"}」失败`);
      }
    }
    if (added.length) setPendingImages((prev) => [...prev, ...added].slice(0, MAX_ATTACH_IMAGES));
  }

  async function handleAttachBrowserScreenshot() {
    if (!captureBrowserScreenshot || capturingShot) return;
    if (pendingImages.length >= MAX_ATTACH_IMAGES) {
      toast.error(`单次最多附带 ${MAX_ATTACH_IMAGES} 张图片`);
      return;
    }
    setCapturingShot(true);
    try {
      const shot = await captureBrowserScreenshot();
      if (!shot?.dataUrl) {
        toast.error("未能获取当前网页截图");
        return;
      }
      const compressed = await compressDataUrl(shot.dataUrl, "image/png", shot.title ? `${shot.title.slice(0, 24)}.jpg` : "网页截图.jpg");
      setPendingImages((prev) => [...prev, compressed].slice(0, MAX_ATTACH_IMAGES));
      toast.success("已附上当前网页截图");
    } catch {
      toast.error("截取当前网页失败");
    } finally {
      setCapturingShot(false);
    }
  }

  function newChat() {
    abortRef.current?.abort();
    generation.current++;
    threadRef.current = null;
    setMessages([]);
    nextId.current = 0;
    setThreadId(null);
    setTab("chat");
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  async function openThread(id: string) {
    abortRef.current?.abort();
    generation.current++;
    const res = await loadAgentConversation(id);
    if (!res.ok || !res.data) return void toast.error(res.ok ? "这段对话不在了" : res.message);
    // Buttons from an old thread are not offered again: the records have moved on.
    const restored = toDisplay(res.data.messages, isRecent(res.data.updatedAt));
    setMessages(restored);
    nextId.current = restored.length;
    setThreadId(res.data.id);
    setTab("chat");
  }

  async function removeThread(id: string) {
    const res = await deleteAgentConversation(id);
    if (!res.ok) return void toast.error(res.message);
    setThreads((prev) => prev?.filter((thread) => thread.id !== id) ?? null);
    if (id === threadId) newChat();
  }

  async function runTurn(content: string, history: AssistantChatMessage[], images?: ChatImageAttachment[], modeOverride?: AgentMode): Promise<TurnResult> {
    const controller = new AbortController();
    abortRef.current = controller;
    liveTextRef.current = "";
    liveThoughtRef.current = "";
    liveStepsRef.current = [];
    setLive({ steps: [], note: "", text: "", thought: "" });
    try {
      const page = pageContext ? await pageContext().catch(() => null) : null;
      return await streamTurn(content, history, page, routeContext, images, modeOverride ?? modeRef.current, deepThinking ? "deep" : "auto", controller.signal, (event) => {
        if (event.type === "meta" && event.thinking) {
          setLive((prev) => ({ ...prev, thinkingLevel: event.thinking }));
        } else if (event.type === "step" && event.step) {
          const step = event.step;
          const nextSteps = liveStepsRef.current.some((item) => item.id === step.id)
            ? liveStepsRef.current.map((item) => (item.id === step.id ? step : item))
            : [...liveStepsRef.current, step];
          liveStepsRef.current = nextSteps;
          setLive((prev) => ({ ...prev, steps: nextSteps }));
        } else if (event.type === "note" && event.text) setLive((prev) => ({ ...prev, note: event.text! }));
        else if (event.type === "thought" && event.text) {
          liveThoughtRef.current += event.text;
          setLive((prev) => ({ ...prev, thought: prev.thought + event.text }));
        }
        // The reply as the model writes it; a new model turn (after looking things up) starts over.
        else if (event.type === "reset") {
          liveTextRef.current = "";
          setLive((prev) => ({ ...prev, text: "" }));
        } else if (event.type === "delta" && event.text) {
          liveTextRef.current += event.text;
          setLive((prev) => ({ ...prev, text: prev.text + event.text }));
        }
      });
    } catch {
      if (controller.signal.aborted) {
        return { ok: false, message: "已停止生成", aborted: true };
      }
      return { ok: false, message: "连接中断，本次请求未完成。请稍后重试。" };
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLive({ steps: [], note: "", text: "", thought: "" });
    }
  }

  async function retryMessage(message: DisplayMessage) {
    if (!message.failedRequest || busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    try {
      const res = await runTurn(message.failedRequest.message, message.failedRequest.history);
      if (!res.ok && !res.aborted) toast.error(res.message);
      update((prev) => prev.map((m) => m.id !== message.id ? m : res.ok
        ? { id: m.id, role: "assistant", content: res.reply, ...(res.refs ? { refs: res.refs } : {}), actions: res.actions, steps: res.steps, notices: res.notices, applied: [], drafts: res.drafts.length ? res.drafts : undefined, filled: [] }
        : { ...m, content: res.message }));
    } finally {
      busyRef.current = false;
      setSending(false);
    }
  }

  async function regenerateReply(messageId: number) {
    if (busyRef.current || !loaded) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx <= 0) return;
    let userIdx = idx - 1;
    while (userIdx >= 0 && messages[userIdx].role !== "user") userIdx--;
    if (userIdx < 0) return;
    const userContent = messages[userIdx].content;
    const prior = messages.slice(0, userIdx);
    const history = prior.filter((m) => !m.failedRequest).map(({ role, content, refs }) => ({ role, content, ...(refs ? { refs } : {}) }));
    update(() => messages.slice(0, userIdx + 1));
    busyRef.current = true;
    stickToBottomRef.current = true;
    setSending(true);
    try {
      const res = await runTurn(userContent, history);
      onReply?.();
      if (res.ok) addMessage("assistant", res.reply, res.actions, res.steps, res.notices, res.drafts, res.refs || undefined, undefined, liveThoughtRef.current.trim() || undefined);
      else if (res.aborted) {
        const partial = liveTextRef.current.trim();
        addMessage("assistant", partial ? `${partial}\n\n（已停止生成）` : "（已停止生成）", undefined, liveStepsRef.current.length ? liveStepsRef.current : undefined);
      } else {
        toast.error(res.message);
        const id = nextId.current++;
        update((prev) => [...prev, { id, role: "assistant", content: res.message, failedRequest: { message: userContent, history } }]);
      }
    } finally {
      setSending(false);
      busyRef.current = false;
    }
  }

  function editUserMessage(message: DisplayMessage) {
    if (sending) return;
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx < 0) return;
    update(() => messages.slice(0, idx));
    setInput(message.content);
    setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function handleSend(text?: string, modeOverride?: AgentMode) {
    const raw = (text ?? input).trim();
    const attached = text === undefined ? pendingImages : [];
    const content = raw || (attached.length ? "请帮我看看这张图，提取关键信息并告诉我下一步建议。" : "");
    if (!content || busyRef.current || !loaded) return;
    if (content.length > 6000) { toast.error("单条消息请控制在 6000 字以内"); return; }
    busyRef.current = true;
    stickToBottomRef.current = true;
    setShowScrollDown(false);
    setTab("chat");
    const history = messages.filter((m) => !m.failedRequest).map(({ role, content, refs }) => ({ role, content, ...(refs ? { refs } : {}) }));
    addMessage("user", content, undefined, undefined, undefined, undefined, undefined, attached);
    // A tapped suggestion leaves whatever was being typed alone.
    if (text === undefined) {
      setInput("");
      setPendingImages([]);
    }
    setSending(true);
    try {
      const res = await runTurn(content, history, attached.length ? attached : undefined, modeOverride);
      onReply?.();
      if (res.ok) addMessage("assistant", res.reply, res.actions, res.steps, res.notices, res.drafts, res.refs || undefined, undefined, liveThoughtRef.current.trim() || undefined);
      else if (res.aborted) {
        const partial = liveTextRef.current.trim();
        addMessage("assistant", partial ? `${partial}\n\n（已停止生成）` : "（已停止生成）", undefined, liveStepsRef.current.length ? liveStepsRef.current : undefined);
      } else {
        // A failed call should be noticed even with the window scrolled away.
        toast.error(res.message);
        const id = nextId.current++;
        update((prev) => [...prev, { id, role: "assistant", content: res.message, failedRequest: { message: content, history } }]);
      }
    } finally {
      setSending(false);
      busyRef.current = false;
    }
  }

  useEffect(() => {
    if (!askText) return;
    // A question to send waits for the saved conversation to load, and for a turn already running.
    if (askSend && (!loaded || sending)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a question handed over from another page
    setTab("chat");
    if (askMode) setMode(askMode);
    if (askSend) void handleSend(askText);
    else setInput(askText.slice(0, 6000));
    onAskConsumed?.();
    // handleSend reads the latest messages itself; re-running on its identity would send twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askText, askSend, askMode, loaded, sending, onAskConsumed]);

  async function handleApply(messageId: number, index: number, action: AssistantAction) {
    const token = `${messageId}:${index}`;
    if (applying) return;
    setApplying(token);
    try {
      const res = await applyAssistantAction(action);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (res.data.downloadUrl) {
        window.open(res.data.downloadUrl, "_blank", "noopener");
      }
      if (res.data.batchJobs?.length) {
        await launchBatchApply(res.data.batchJobs, (href) => {
          onNavigate?.();
          router.push(href);
        });
      }
      toast.success(res.data.done);
      update((prev) => prev.map((m) => (m.id === messageId ? { ...m, applied: [...(m.applied ?? []), index] } : m)));
      addMessage(
        "assistant",
        res.data.href ? `操作已完成：${res.data.done}（[点击查看](${res.data.href})）` : `操作已完成：${res.data.done}`
      );
      router.refresh();
    } catch {
      toast.error("未能确认保存结果，请先检查记录再重试。");
    } finally {
      setApplying(null);
    }
  }

  /** Every non-destructive button of one message not yet saved, one after another; destructive ones require individual clicks. */
  async function handleApplyAll(messageId: number) {
    const message = messages.find((m) => m.id === messageId);
    if (applying || !message?.actions) return;
    const allPending = message.actions.map((action, index) => ({ action, index })).filter(({ index }) => !message.applied?.includes(index));
    const pending = allPending.filter(({ action }) => !DESTRUCTIVE_ACTIONS.has(action.type));
    const skippedDestructive = allPending.length - pending.length;
    if (!pending.length) {
      if (skippedDestructive > 0) toast.info("删除类操作需要单独点击「确认删除」");
      return;
    }
    setApplying(`${messageId}:all`);
    const saved: number[] = [];
    const failed: string[] = [];
    const queuedBatch: { url: string; positionId?: string; company?: string; title?: string }[] = [];
    try {
      for (const { action, index } of pending) {
        const res = await applyAssistantAction(action).catch(() => null);
        if (res?.ok) {
          saved.push(index);
          if (res.data.downloadUrl) window.open(res.data.downloadUrl, "_blank", "noopener");
          if (res.data.batchJobs?.length) queuedBatch.push(...res.data.batchJobs);
        }
        else failed.push(`${action.label}${res && !res.ok ? `（${res.message}）` : ""}`);
      }
      if (queuedBatch.length) {
        await launchBatchApply(queuedBatch, (href) => {
          onNavigate?.();
          router.push(href);
        });
      }
    } finally {
      if (saved.length) update((prev) => prev.map((m) => (m.id === messageId ? { ...m, applied: [...(m.applied ?? []), ...saved] } : m)));
      if (saved.length) toast.success(`已保存 ${saved.length} 项${skippedDestructive ? `（已跳过 ${skippedDestructive} 项删除操作）` : ""}`);
      if (failed.length) toast.error(`${failed.length} 项没保存，可以单独再点`);
      addMessage("assistant", `操作已完成：保存了 ${saved.length} 项${skippedDestructive ? `；${skippedDestructive} 项删除操作需单独确认` : ""}${failed.length ? `；没保存：${failed.join("、")}` : ""}`);
      if (saved.length) router.refresh();
      setApplying(null);
    }
  }

  async function copy(text: string) {
    try {
      await copyText(text);
      toast.success("已复制，可以直接粘贴到网申里");
    } catch {
      toast.error("复制失败，请手动选中文字复制");
    }
  }

  async function fillDraft(messageId: number, index: number, draft: PageDraft) {
    if (!onFillField) return;
    const ok = await onFillField(draft);
    if (ok) update((prev) => prev.map((m) => (m.id === messageId ? { ...m, filled: [...(m.filled ?? []), index] } : m)));
  }

  async function fillAllDrafts(messageId: number, drafts: PageDraft[], alreadyFilled: number[]) {
    if ((!onFillFields && !onFillField) || applying) return;
    const pendingEntries = drafts.map((draft, index) => ({ draft, index })).filter(({ index }) => !alreadyFilled.includes(index));
    if (!pendingEntries.length) return;
    setApplying(`${messageId}:drafts`);
    try {
      let filledRelative: number[] = [];
      if (onFillFields) {
        filledRelative = await onFillFields(pendingEntries.map((item) => item.draft));
      } else if (onFillField) {
        for (let i = 0; i < pendingEntries.length; i++) {
          if (await onFillField(pendingEntries[i].draft)) filledRelative.push(i);
        }
      }
      const filledIndexes = filledRelative.map((relIdx) => pendingEntries[relIdx]?.index).filter((v): v is number => typeof v === "number");
      if (filledIndexes.length) {
        update((prev) => prev.map((m) => (m.id === messageId ? { ...m, filled: [...new Set([...(m.filled ?? []), ...filledIndexes])] } : m)));
      }
    } finally {
      setApplying(null);
    }
  }

  async function savePlan() {
    if (planDraft === null) return;
    const res = await saveAgentPlan(planDraft);
    if (!res.ok) return void toast.error(res.message);
    setState((prev) => prev && { ...prev, plan: planDraft.trim(), planAt: planDraft.trim() ? res.data.planAt : null });
    setPlanDraft(null);
    toast.success("计划已保存，小欧下次会在这个基础上更新");
  }

  async function addMemory() {
    const res = await addAgentMemory(memoryDraft);
    if (!res.ok) return void toast.error(res.message);
    setState((prev) => prev && { ...prev, memories: [...prev.memories, res.data] });
    setMemoryDraft("");
  }

  async function removeMemory(id: string) {
    const res = await deleteAgentMemory(id);
    if (!res.ok) return void toast.error(res.message);
    setState((prev) => prev && { ...prev, memories: prev.memories.filter((memory) => memory.id !== id) });
  }

  async function saveToDesktopNote(text: string) {
    const res = await createNoteWithContent(text);
    if (!res.ok) return void toast.error(res.message);
    toast.success("已存入桌面便签");
  }

  function exportConversationMarkdown() {
    if (!messages.length) return;
    const today = new Date().toLocaleDateString("sv-SE");
    const lines = [
      `# 小欧求职对话记录（${today}）`,
      "",
      ...messages
        .filter((m) => !m.failedRequest)
        .map((m) => `## ${m.role === "user" ? "我" : "小欧"}\n\n${m.content.trim()}\n`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `小欧对话-${today}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("已导出 Markdown 对话记录");
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {header}
      <div className="flex items-center gap-1 border-b px-3 py-1.5 text-xs" role="tablist">
        {([["chat", "对话"], ["history", "历史"], ["plan", "求职计划"], ["memory", "小欧的记忆"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => openTab(id)} className={`rounded-full px-2.5 py-1 ${tab === id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
        ))}
        <div className="ml-auto flex items-center gap-0.5">
          {messages.length > 0 && (
            <button type="button" title="导出整段对话为 Markdown" aria-label="导出 Markdown" disabled={sending || !loaded} onClick={exportConversationMarkdown} className="flex items-center gap-1 rounded-full px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
              <Download className="size-3.5" />
            </button>
          )}
          <button type="button" disabled={sending || !!applying || !loaded || !messages.length} onClick={newChat} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Plus className="size-3.5" />新对话</button>
        </div>
      </div>

      {tab === "history" && (
        <div className="flex-1 space-y-1 overflow-y-auto p-2 text-sm">
          {!threads ? <p className="p-2 text-muted-foreground">加载中…</p> : !threads.length ? <p className="p-2 text-muted-foreground">还没有保存的对话。和小欧聊过的会自动留在这里。</p> : threads.map((thread) => (
            <div key={thread.id} className={cn("group flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-muted", thread.id === threadId && "bg-primary/5")}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openThread(thread.id)}>
                <MessageSquareText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{when(thread.updatedAt)} · {thread.count} 条</span>
              </button>
              <button type="button" aria-label="删除这段对话" className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100" onClick={() => removeThread(thread.id)}><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {tab === "plan" && (
        <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
          {!state ? <p className="text-muted-foreground">加载中…</p> : planDraft !== null ? (
            <>
              <Textarea value={planDraft} onChange={(e) => setPlanDraft(e.target.value)} rows={18} maxLength={6000} className="text-sm" />
              <div className="flex gap-2"><Button size="sm" onClick={savePlan}>保存</Button><Button size="sm" variant="ghost" onClick={() => setPlanDraft(null)}>取消</Button></div>
            </>
          ) : state.plan ? (
            <>
              <p className="text-xs text-muted-foreground">小欧在帮你规划时会更新这份计划{state.planAt ? `，上次更新 ${new Date(state.planAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}。你也可以直接改。</p>
              <MarkdownText text={state.plan} className="rounded-lg border p-3" />
              <Button size="sm" variant="outline" onClick={() => setPlanDraft(state.plan)}>编辑计划</Button>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground">还没有求职计划。让小欧看看你的投递和候选池，排一份本周计划：</p>
              <Button size="sm" disabled={sending} onClick={() => handleSend("帮我规划这周：看看我的投递、截止和面试，排出优先级，并更新求职计划")}>帮我做一份计划</Button>
            </div>
          )}
        </div>
      )}

      {tab === "memory" && (
        <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
          <p className="text-xs text-muted-foreground">你说过的长期偏好和情况（目标、城市、底线、不考虑的公司…），小欧每次对话都会带上。记错了就删掉。</p>
          {!state ? <p className="text-muted-foreground">加载中…</p> : state.memories.length === 0 ? <p className="text-muted-foreground">还没有记忆。聊天时说「记住：我不考虑外包」，或在下面直接加。</p> : (
            <ul className="space-y-1.5">
              {state.memories.map((memory) => (
                <li key={memory.id} className="flex items-start gap-2 rounded-md border px-2.5 py-1.5">
                  <span className="flex-1">{memory.content}</span>
                  <button type="button" aria-label="删除这条记忆" className="text-muted-foreground hover:text-destructive" onClick={() => removeMemory(memory.id)}><Trash2 className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 pt-1">
            <Input value={memoryDraft} onChange={(e) => setMemoryDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void addMemory(); }} placeholder="比如：只看上海、杭州；12 月中旬要答辩" maxLength={300} className="h-8" />
            <Button size="sm" disabled={!memoryDraft.trim()} onClick={addMemory}>加一条</Button>
          </div>
        </div>
      )}

      {tab === "chat" && (
        <>
          <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/25 px-2.5 py-1 text-[11px] [scrollbar-width:none]">
            {AGENT_MODE_LIST.map((item) => {
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={sending}
                  title={item.description}
                  onClick={() => setMode(item.id)}
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 transition-colors disabled:opacity-50",
                    active
                      ? "bg-primary text-primary-foreground font-medium shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {item.shortLabel}
                </button>
              );
            })}
            <button
              type="button"
              disabled={sending}
              title={deepThinking ? "已锁定深度推理模式（再次点击恢复智能自动分流）" : "当前为快慢思考自动分流（点击可强制开启深度推理）"}
              onClick={() => setDeepThinking((prev) => !prev)}
              className={cn(
                "ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 transition-colors disabled:opacity-50",
                deepThinking || mode !== "general"
                  ? "border-primary/40 bg-primary/10 font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Brain className="size-3" />
              {deepThinking ? "深度" : mode !== "general" ? "专家深度" : "自动"}
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-2.5 overflow-y-auto p-3">
              {messages.length === 0 ? (
                <div className="space-y-2">
                  {mode !== "general" ? (
                    <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-foreground">
                      <p className="font-medium text-primary">{AGENT_MODE_MAP[mode].label}</p>
                      <p className="mt-0.5 text-muted-foreground">{AGENT_MODE_MAP[mode].description}</p>
                    </div>
                  ) : (
                    intro ?? (
                      <p className="text-sm text-muted-foreground">
                        把求职的事交给我：我会自己查你的记录、读 JD 和简历、上官网找岗位、联网研究，然后给你明确的建议和计划。
                        要改记录时我会给出按钮，你点了才保存；我不会替你发邮件或提交网申。
                      </p>
                    )
                  )}
                  <Link href="/settings?tab=ai" onClick={onNavigate} className="inline-block text-xs text-primary underline">配置 AI 服务商和 API Key</Link>
                  {(mode !== "general" ? AGENT_MODE_MAP[mode].quickQuestions : suggestions).map((s) => (
                    <button key={s} type="button" disabled={!loaded} onClick={() => handleSend(s)} className="block w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted">{s}</button>
                  ))}
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="group/msg flex flex-col gap-1.5">
                    {!!m.steps?.length && <StepsSummary steps={m.steps} onNavigate={onNavigate} />}
                    {!!m.thought && (
                      <details className="group/thought px-1 text-xs">
                        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                          <Brain className="size-3.5 text-primary/70" />
                          思考过程（{m.thought.length} 字）
                          <ChevronRight className="size-3.5 transition-transform group-open/thought:rotate-90" />
                        </summary>
                        <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/40 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
                          {m.thought}
                        </div>
                      </details>
                    )}
                    <div className={m.failedRequest ? "mr-6 rounded-2xl rounded-bl-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm" : m.role === "assistant" ? "bubble-ai group relative mr-6 rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm" : "bubble-user group relative max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground"}>
                      {!!m.images?.length && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {m.images.map((img, idx) => (
                            // eslint-disable-next-line @next/next/no-img-element -- local user-attached base64 preview
                            <img key={idx} src={img.dataUrl} alt={img.name || `附图 ${idx + 1}`} className="max-h-28 max-w-36 rounded-lg border border-white/20 object-cover" />
                          ))}
                        </div>
                      )}
                      {m.role === "assistant" && !m.failedRequest ? (
                        <MarkdownText text={m.content} onNavigate={onNavigate} />
                      ) : (
                        <p className="whitespace-pre-wrap">{m.failedRequest && <CircleAlert className="mr-1 inline size-3.5 -translate-y-px text-destructive" />}{m.content}</p>
                      )}
                      {m.failedRequest && (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" disabled={sending || !!applying} onClick={() => retryMessage(m)}>重新发送</Button>
                          <Link href="/settings?tab=ai" onClick={onNavigate} className="inline-flex h-8 items-center rounded-md px-2 text-xs text-primary underline">去设置换模型</Link>
                        </div>
                      )}
                    </div>
                    {!m.failedRequest && (
                      <div className={cn("flex items-center gap-1 px-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100", m.role === "user" && "justify-end")}>
                        <button type="button" title="复制" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground" onClick={() => copy(m.content)}>
                          <Copy className="size-3" />复制
                        </button>
                        {m.role === "assistant" && (
                          <button type="button" title="存入桌面便签" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground" onClick={() => void saveToDesktopNote(m.content)}>
                            <StickyNote className="size-3" />存便签
                          </button>
                        )}
                        {m.role === "assistant" && !sending && (
                          <button type="button" title="重新生成" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground" onClick={() => void regenerateReply(m.id)}>
                            <RotateCcw className="size-3" />重试
                          </button>
                        )}
                        {m.role === "user" && !sending && (
                          <button type="button" title="编辑并重发" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground" onClick={() => editUserMessage(m)}>
                            <Pencil className="size-3" />编辑
                          </button>
                        )}
                      </div>
                    )}
                    {!!m.notices?.length && <p className="px-1 text-xs text-amber-600 dark:text-amber-400">{m.notices.join("；")}</p>}

                    {(m.drafts?.length ?? 0) - (m.filled?.length ?? 0) >= 2 && (onFillFields || onFillField) && (
                      <Button size="sm" variant="outline" className="w-full text-xs" disabled={!!applying} onClick={() => void fillAllDrafts(m.id, m.drafts ?? [], m.filled ?? [])}>
                        {applying === `${m.id}:drafts` ? <><Loader2 className="size-3.5 animate-spin" />正在填入网页…</> : <><Check className="size-3.5" />一键全部填入本页（{(m.drafts?.length ?? 0) - (m.filled?.length ?? 0)} 项）</>}
                      </Button>
                    )}
                    {m.drafts?.map((draft, i) => {
                      const done = m.filled?.includes(i);
                      return (
                        <div key={`d${i}`} className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
                          <p className="font-medium text-foreground">{draft.section ? `${draft.section} · ${draft.question}` : draft.question}</p>
                          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{draft.answer}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            {onFillField && <Button size="sm" variant={done ? "outline" : "default"} onClick={() => fillDraft(m.id, i, draft)}>{done ? <><Check className="size-3.5" />已填进去（再填一次）</> : "填进这一栏"}</Button>}
                            <Button size="sm" variant="ghost" onClick={() => copy(draft.answer)}><Copy className="size-3.5" />复制</Button>
                            <span className="text-muted-foreground">{draft.answer.replace(/\s/g, "").length} 字</span>
                          </div>
                        </div>
                      );
                    })}

                    {(() => {
                      const safePending = (m.actions ?? []).filter((act, idx) => !m.applied?.includes(idx) && !DESTRUCTIVE_ACTIONS.has(act.type)).length;
                      if (safePending < 2) return null;
                      return (
                        <Button size="sm" variant="outline" className="w-full text-xs" disabled={!!applying} onClick={() => handleApplyAll(m.id)}>
                          {applying === `${m.id}:all` ? <><Loader2 className="size-3.5 animate-spin" />保存中…</> : <><Check className="size-3.5" />一键全部保存（{safePending} 项）</>}
                        </Button>
                      );
                    })()}
                    {m.actions?.map((action, i) => {
                      const done = m.applied?.includes(i);
                      const busy = applying === `${m.id}:${i}`;
                      const destructive = DESTRUCTIVE_ACTIONS.has(action.type);
                      const chips = actionMetaChips(action);
                      return (
                        <button
                          key={i}
                          type="button"
                          disabled={done || !!applying}
                          onClick={() => handleApply(m.id, i, action)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-xl border bg-card px-3 py-2 text-left text-xs shadow-xs transition-colors enabled:hover:bg-muted disabled:shadow-none disabled:opacity-70",
                            destructive && !done && "border-destructive/40 bg-destructive/[0.04] enabled:hover:bg-destructive/10"
                          )}
                        >
                          {done ? (
                            <Check className="mt-0.5 size-3.5 shrink-0 text-green-600" />
                          ) : destructive ? (
                            <Trash2 className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                          ) : (
                            <Plus className="mt-0.5 size-3.5 shrink-0 text-primary" />
                          )}
                          <span className="min-w-0 flex-1 space-y-1">
                            <span className="block font-medium text-foreground">{action.label}</span>
                            {chips.length > 0 && (
                              <span className="flex flex-wrap gap-1">
                                {chips.map((chip) => (
                                  <span key={chip} className="rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {chip}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "mt-0.5 shrink-0 rounded-full px-2 py-0.5",
                              done || busy
                                ? "text-muted-foreground"
                                : destructive
                                  ? "bg-destructive/15 font-medium text-destructive"
                                  : "bg-primary/10 font-medium text-primary"
                            )}
                          >
                            {done ? "已保存" : busy ? "执行中…" : destructive ? "确认删除" : "保存"}
                          </span>
                        </button>
                      );
                    })}
                    {m.steps?.some((step) => step.tool === "research_cities" || step.tool === "list_missing_cities") && /(?:还剩|还有|其余|下一批|接着查|继续查)/.test(m.content) && (
                      <Button size="sm" variant="secondary" className="w-full text-xs" disabled={sending || !!applying} onClick={() => handleSend("继续查下一批还没查的投递城市，查到的给我按钮保存")}>
                        继续查下一批城市
                      </Button>
                    )}
                  </div>
                ))
              )}
              {sending && (
                <div className="px-1 text-xs" aria-live="polite">
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                    {(() => {
                      const running = [...live.steps].reverse().find((s) => s.status === "running");
                      if (running) return `正在：${running.label}…`;
                      if (live.text.trim()) return "小欧正在组织回答…";
                      if (live.thought.trim()) return live.thinkingLevel === "deep" ? "小欧正在深度推理…" : "小欧正在思考…";
                      return live.steps.length ? "小欧正在整理结果…" : "小欧在想该怎么做…";
                    })()}
                  </p>
                  {live.note && <p className="mt-1 text-muted-foreground">{live.note}</p>}
                  {!!live.thought.trim() && (
                    <details className="group/thought mt-1.5">
                      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                        <Brain className="size-3.5 text-primary/70" />
                        思考中（{live.thought.length} 字）
                        <ChevronRight className="size-3.5 transition-transform group-open/thought:rotate-90" />
                      </summary>
                      <div className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5 text-xs leading-5 text-muted-foreground">
                        {live.thought}
                      </div>
                    </details>
                  )}
                  {!!live.steps.length && <ol className="mt-2">{live.steps.map((step) => <StepLine key={step.id} step={step} onNavigate={onNavigate} />)}</ol>}
                </div>
              )}
              {sending && live.text.trim() && (
                <div className="bubble-ai mr-6 rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm" aria-live="off">
                  <MarkdownText text={live.text} onNavigate={onNavigate} />
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-foreground/50 align-middle" aria-hidden />
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {showScrollDown && (
              <button
                type="button"
                onClick={scrollToBottom}
                aria-label="回到底部"
                className="absolute bottom-2 right-3 inline-flex items-center gap-1 rounded-full border bg-card/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-md backdrop-blur-md transition-colors hover:bg-muted"
              >
                <ArrowDown className="size-3" />回到底部
              </button>
            )}
          </div>

          <div className="flex gap-1.5 overflow-x-auto border-t px-2 pt-2 [scrollbar-width:none]">
            {(mode !== "general" ? AGENT_MODE_MAP[mode].quickQuestions : quickQuestions).map((question) => (
              <button key={question} type="button" disabled={sending || !loaded} onClick={() => handleSend(question)} className="shrink-0 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">{question}</button>
            ))}
          </div>
          {!!pendingImages.length && (
            <div className="flex flex-wrap gap-1.5 border-t bg-muted/30 px-2.5 pt-2 pb-1">
              {pendingImages.map((img, idx) => (
                <div key={idx} className="group/img relative overflow-hidden rounded-lg border bg-background">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
                  <img src={img.dataUrl} alt={img.name || `附图 ${idx + 1}`} className="h-14 w-14 object-cover" />
                  <button
                    type="button"
                    aria-label="移除图片"
                    onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                    className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            className="flex items-end gap-1.5 p-2"
            onDragOver={(e) => {
              if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              if (e.dataTransfer?.files?.length) {
                e.preventDefault();
                void attachImageFiles(e.dataTransfer.files);
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void attachImageFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <VoiceInput disabled={sending || !loaded} onText={(text) => setInput((previous) => (previous ? previous + "\n" + text : text).slice(0, 6000))} />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="上传图片"
              title="上传图片（也可直接 Ctrl/Cmd+V 粘贴或拖拽截图）"
              disabled={sending || !loaded || pendingImages.length >= MAX_ATTACH_IMAGES}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-4" />
            </Button>
            {captureBrowserScreenshot && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="附当前网页截图"
                title="截取当前网申网页发给小欧看"
                disabled={sending || !loaded || capturingShot || pendingImages.length >= MAX_ATTACH_IMAGES}
                onClick={() => void handleAttachBrowserScreenshot()}
              >
                {capturingShot ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
              </Button>
            )}
            <textarea
              ref={composerRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                const files: File[] = [];
                for (let i = 0; i < items.length; i++) {
                  if (items[i].type.startsWith("image/")) {
                    const f = items[i].getAsFile();
                    if (f) files.push(f);
                  }
                }
                if (files.length) {
                  e.preventDefault();
                  void attachImageFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={AGENT_MODE_MAP[mode].placeholder}
              aria-label="给小欧发送消息"
              maxLength={6000}
              disabled={sending || !loaded}
              className="max-h-[140px] min-h-9 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
            {sending ? (
              <Button type="button" size="icon" variant="destructive" className="size-9 shrink-0" aria-label="停止生成" title="停止生成" onClick={stopGenerating}>
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button type="button" size="icon" className="size-9 shrink-0" aria-label="发送" disabled={(!input.trim() && !pendingImages.length) || !loaded} onClick={() => handleSend()}>
                <Send className="size-4" />
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
