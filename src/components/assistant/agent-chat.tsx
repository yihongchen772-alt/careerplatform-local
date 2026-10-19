"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Send, Check, Plus, Loader2, CircleAlert, CircleCheck, Trash2, Copy, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { applyAssistantAction } from "@/lib/actions/assistant";
import { addAgentMemory, deleteAgentMemory, getAgentState, saveAgentPlan, type AgentState } from "@/lib/actions/agent-memory";
import { deleteAgentConversation, listAgentConversations, loadAgentConversation, saveAgentConversation, type AgentThreadSummary } from "@/lib/actions/agent-conversation";
import { assistantActionSchema, type AssistantAction, type AssistantChatMessage } from "@/lib/assistant-shared";
import type { AgentStep } from "@/lib/agent/run";
import { VoiceInput } from "./voice-input";
import { MarkdownText } from "./markdown-text";
import { cn } from "@/lib/utils";

type DisplayMessage = AssistantChatMessage & {
  id: number;
  actions?: AssistantAction[];
  /** Indices of this message's actions already applied, so they don't run twice. */
  applied?: number[];
  steps?: AgentStep[];
  /** Backup models used this turn ("…过载，改用 …"). */
  notices?: string[];
  failedRequest?: { message: string; history: AssistantChatMessage[] };
  /** Answers drafted for the open page's questions (「填进这一栏」), and which went in. */
  drafts?: PageDraft[];
  filled?: number[];
};

export type PageDraft = { question: string; answer: string };

/** The 网申 page open beside 小欧 (网申浏览器's side panel). */
export type AgentPageContext = { url: string; title: string; text: string; questions: { label: string; value: string }[]; positionId?: string };

type TurnResult = { ok: true; reply: string; actions: AssistantAction[]; drafts: PageDraft[]; steps: AgentStep[]; notices: string[] } | { ok: false; message: string };
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
    <li className="flex gap-1.5">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${step.status === "running" ? "animate-spin text-muted-foreground" : step.status === "error" ? "text-destructive" : "text-green-600"}`} />
      <div className="min-w-0">
        <p className={step.status === "error" ? "text-destructive" : "font-medium"}>{step.label}</p>
        {step.summary && <p className="text-muted-foreground">{step.summary}</p>}
        {step.href && <Link href={step.href} onClick={onNavigate} className="text-primary underline">{hrefLinkLabel(step.href)}</Link>}
      </div>
    </li>
  );
}

/** Reads the agent's NDJSON stream; `onEvent` sees each step as it happens. */
async function streamTurn(message: string, history: AssistantChatMessage[], page: AgentPageContext | null, onEvent: (event: { type: string; step?: AgentStep; text?: string }) => void): Promise<TurnResult> {
  const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, history, ...(page ? { page } : {}) }) });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null);
    return { ok: false, message: body?.error ?? "小欧暂时连不上，请稍后重试" };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "done") return { ok: true, reply: event.reply, actions: event.actions ?? [], drafts: event.drafts ?? [], steps: event.steps ?? [], notices: event.notices ?? [] };
      if (event.type === "error") return { ok: false, message: event.message };
      onEvent(event);
    }
    if (done) return { ok: false, message: "连接中断，本次请求未完成。请稍后重试。" };
  }
}

function toDisplay(stored: Array<Record<string, unknown>>, keepActions: boolean): DisplayMessage[] {
  return stored.map((m, id) => {
    const actions = keepActions && Array.isArray(m.actions) ? m.actions.map((item) => assistantActionSchema.safeParse(item)).filter((item) => item.success).map((item) => item.data) : undefined;
    return {
      id, role: m.role as "user" | "assistant", content: String(m.content ?? ""), actions, applied: Array.isArray(m.applied) ? (m.applied as number[]) : [],
      steps: Array.isArray(m.steps) ? (m.steps as AgentStep[]) : undefined, notices: Array.isArray(m.notices) ? (m.notices as string[]) : undefined,
      failedRequest: m.failedRequest as DisplayMessage["failedRequest"],
      drafts: Array.isArray(m.drafts) ? (m.drafts as PageDraft[]) : undefined, filled: Array.isArray(m.filled) ? (m.filled as number[]) : [],
    };
  });
}

function toStored(messages: DisplayMessage[]) {
  return messages.map(({ role, content, actions, applied, steps, notices, failedRequest, drafts, filled }) => ({ role, ...(drafts?.length ? { drafts, filled: filled ?? [] } : {}), content: content.slice(0, 16000), ...(actions?.length ? { actions } : {}), ...(applied?.length ? { applied } : {}), ...(steps?.length ? { steps: steps.map((step) => ({ ...step, label: step.label.slice(0, 300), summary: step.summary.slice(0, 400) })) } : {}), ...(notices?.length ? { notices } : {}), ...(failedRequest ? { failedRequest: { message: failedRequest.message, history: failedRequest.history.slice(-20) } } : {}) }));
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
export function AgentChat({ header, pageContext, suggestions = DEFAULT_SUGGESTIONS, quickQuestions = DEFAULT_QUICK_QUESTIONS, intro, askText, onAskConsumed, onNavigate, onReply, onFillField, className }: {
  header: ReactNode;
  pageContext?: () => Promise<AgentPageContext | null>;
  suggestions?: string[];
  quickQuestions?: string[];
  intro?: ReactNode;
  /** A question typed in from elsewhere (「接着问小欧」). */
  askText?: string | null;
  onAskConsumed?: () => void;
  onNavigate?: () => void;
  /** A turn finished (answered or failed) — for a dot when the panel is closed. */
  onReply?: () => void;
  /** 网申浏览器 only: writes a drafted answer into the page box with that question. */
  onFillField?: (draft: PageDraft) => Promise<boolean>;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<AgentThreadSummary[] | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<{ steps: AgentStep[]; note: string }>({ steps: [], note: "" });
  const [applying, setApplying] = useState<string | null>(null);
  const [state, setState] = useState<AgentState | null>(null);
  const [planDraft, setPlanDraft] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const nextId = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const threadRef = useRef<string | null>(null);
  const dirty = useRef(false);
  // Bumped by 新对话 / opening a thread: a save still on its way for the
  // previous thread must not bind the new one to that thread's id.
  const generation = useRef(0);

  useEffect(() => { threadRef.current = threadId; }, [threadId]);

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

  useEffect(() => {
    if (!askText) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a question handed over from another page
    setTab("chat");
    setInput(askText.slice(0, 6000));
    onAskConsumed?.();
  }, [askText, onAskConsumed]);

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
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [messages, loaded, sending]);

  useEffect(() => {
    if (tab === "chat") bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, live, sending, tab]);

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

  function addMessage(role: "user" | "assistant", content: string, actions?: AssistantAction[], steps?: AgentStep[], notices?: string[], drafts?: PageDraft[]) {
    const id = nextId.current++;
    update((prev) => [...prev, { id, role, content, actions, steps, notices, applied: [], drafts: drafts?.length ? drafts : undefined, filled: [] }]);
  }

  function newChat() {
    generation.current++;
    threadRef.current = null;
    setMessages([]);
    nextId.current = 0;
    setThreadId(null);
    setTab("chat");
  }

  async function openThread(id: string) {
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

  async function runTurn(content: string, history: AssistantChatMessage[]): Promise<TurnResult> {
    setLive({ steps: [], note: "" });
    try {
      const page = pageContext ? await pageContext().catch(() => null) : null;
      return await streamTurn(content, history, page, (event) => {
        if (event.type === "step" && event.step) {
          const step = event.step;
          setLive((prev) => ({ ...prev, steps: prev.steps.some((item) => item.id === step.id) ? prev.steps.map((item) => item.id === step.id ? step : item) : [...prev.steps, step] }));
        } else if (event.type === "note" && event.text) setLive((prev) => ({ ...prev, note: event.text! }));
      });
    } catch {
      return { ok: false, message: "连接中断，本次请求未完成。请稍后重试。" };
    } finally {
      setLive({ steps: [], note: "" });
    }
  }

  async function retryMessage(message: DisplayMessage) {
    if (!message.failedRequest || busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    try {
      const res = await runTurn(message.failedRequest.message, message.failedRequest.history);
      if (!res.ok) toast.error(res.message);
      update((prev) => prev.map((m) => m.id !== message.id ? m : res.ok
        ? { id: m.id, role: "assistant", content: res.reply, actions: res.actions, steps: res.steps, notices: res.notices, applied: [], drafts: res.drafts.length ? res.drafts : undefined, filled: [] }
        : { ...m, content: res.message }));
    } finally {
      busyRef.current = false;
      setSending(false);
    }
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busyRef.current || !loaded) return;
    if (content.length > 6000) { toast.error("单条消息请控制在 6000 字以内"); return; }
    busyRef.current = true;
    setTab("chat");
    const history = messages.filter((m) => !m.failedRequest).map(({ role, content }) => ({ role, content }));
    addMessage("user", content);
    // A tapped suggestion leaves whatever was being typed alone.
    if (text === undefined) setInput("");
    setSending(true);
    try {
      const res = await runTurn(content, history);
      onReply?.();
      if (res.ok) addMessage("assistant", res.reply, res.actions, res.steps, res.notices, res.drafts);
      else {
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
      toast.success(res.data.done);
      update((prev) => prev.map((m) => (m.id === messageId ? { ...m, applied: [...(m.applied ?? []), index] } : m)));
      addMessage("assistant", `操作已完成：${res.data.done}`);
    } catch {
      toast.error("未能确认保存结果，请先检查记录再重试。");
    } finally {
      setApplying(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
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

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {header}
      <div className="flex items-center gap-1 border-b px-3 py-1.5 text-xs" role="tablist">
        {([["chat", "对话"], ["history", "历史"], ["plan", "求职计划"], ["memory", "小欧的记忆"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => openTab(id)} className={`rounded-full px-2.5 py-1 ${tab === id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
        ))}
        <button type="button" disabled={sending || !!applying || !loaded || !messages.length} onClick={newChat} className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Plus className="size-3.5" />新对话</button>
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
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="space-y-2">
                {intro ?? (
                  <p className="text-sm text-muted-foreground">
                    把求职的事交给我：我会自己查你的记录、读 JD 和简历、上官网找岗位、联网研究，然后给你明确的建议和计划。
                    要改记录时我会给出按钮，你点了才保存；我不会替你发邮件或提交网申。
                  </p>
                )}
                <Link href="/settings?tab=ai" onClick={onNavigate} className="inline-block text-xs text-primary underline">配置 AI 服务商和 API Key</Link>
                {suggestions.map((s) => (
                  <button key={s} type="button" disabled={!loaded} onClick={() => handleSend(s)} className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted">{s}</button>
                ))}
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="space-y-1.5">
                  <div className={m.failedRequest ? "rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm" : m.role === "assistant" ? "bubble-ai group relative rounded-lg bg-muted p-2.5 text-sm" : "bubble-user rounded-lg bg-primary/10 p-2.5 text-sm"}>
                    {m.role === "assistant" && !m.failedRequest ? <MarkdownText text={m.content} /> : <p className="whitespace-pre-wrap">{m.failedRequest && <CircleAlert className="mr-1 inline size-3.5 -translate-y-px text-destructive" />}{m.content}</p>}
                    {m.role === "assistant" && !m.failedRequest && m.content.length > 40 && (
                      <button type="button" aria-label="复制这条回答" title="复制" className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 focus:opacity-100" onClick={() => copy(m.content)}><Copy className="size-3.5" /></button>
                    )}
                    {m.failedRequest && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={sending || !!applying} onClick={() => retryMessage(m)}>重新发送</Button>
                        <Link href="/settings?tab=ai" onClick={onNavigate} className="inline-flex h-8 items-center rounded-md px-2 text-xs text-primary underline">去设置换模型</Link>
                      </div>
                    )}
                  </div>
                  {!!m.notices?.length && <p className="px-1 text-[11px] text-amber-600 dark:text-amber-400">{m.notices.join("；")}</p>}

                  {!!m.steps?.length && (
                    <details className="rounded-lg border p-2 text-xs">
                      <summary className="cursor-pointer font-medium">做了 {m.steps.length} 步{m.steps.some((step) => step.status === "error") ? `（${m.steps.filter((step) => step.status === "error").length} 步没成）` : ""}</summary>
                      <ol className="mt-2 space-y-1.5">{m.steps.map((step) => <StepLine key={step.id} step={step} onNavigate={onNavigate} />)}</ol>
                    </details>
                  )}

                  {m.drafts?.map((draft, i) => {
                    const done = m.filled?.includes(i);
                    return (
                      <div key={`d${i}`} className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
                        <p className="font-medium text-foreground">{draft.question}</p>
                        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-6">{draft.answer}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {onFillField && <Button size="sm" variant={done ? "outline" : "default"} onClick={() => fillDraft(m.id, i, draft)}>{done ? <><Check className="size-3.5" />已填进去（再填一次）</> : "填进这一栏"}</Button>}
                          <Button size="sm" variant="ghost" onClick={() => copy(draft.answer)}><Copy className="size-3.5" />复制</Button>
                          <span className="text-muted-foreground">{draft.answer.replace(/\s/g, "").length} 字</span>
                        </div>
                      </div>
                    );
                  })}

                  {m.actions?.map((action, i) => {
                    const done = m.applied?.includes(i);
                    const busy = applying === `${m.id}:${i}`;
                    return (
                      <button key={i} type="button" disabled={done || !!applying} onClick={() => handleApply(m.id, i, action)} className="flex w-full items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-left text-xs transition-colors enabled:hover:bg-muted disabled:opacity-70">
                        {done ? <Check className="size-3.5 shrink-0 text-green-600" /> : <Plus className="size-3.5 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1">
                          {action.label}
                          {/* The label says things like "下周三", but what
                              gets written is the date the model resolved
                              that to — and it does get that wrong. Show the
                              real value so a bad one is caught before the
                              click, not after. */}
                          {action.date && <span className="ml-1 text-muted-foreground">（{action.date}）</span>}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{done ? "已保存" : busy ? "保存中..." : "点击保存"}</span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
            {sending && (
              <div className="rounded-lg border border-dashed p-2.5 text-xs" aria-live="polite">
                <p className="flex items-center gap-1.5 font-medium"><Loader2 className="size-3.5 animate-spin" />{live.steps.length ? "小欧正在做…" : "小欧在想该怎么做…"}</p>
                {live.note && <p className="mt-1 text-muted-foreground">{live.note}</p>}
                {!!live.steps.length && <ol className="mt-2 space-y-1.5">{live.steps.map((step) => <StepLine key={step.id} step={step} onNavigate={onNavigate} />)}</ol>}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-1.5 overflow-x-auto border-t px-2 pt-2 [scrollbar-width:none]">
            {quickQuestions.map((question) => (
              <button key={question} type="button" disabled={sending || !loaded} onClick={() => handleSend(question)} className="shrink-0 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">{question}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 p-2">
            <VoiceInput disabled={sending || !loaded} onText={(text) => setInput((previous) => (previous ? previous + "\n" + text : text).slice(0, 6000))} />
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSend();
              }}
              placeholder="交给小欧一件事，或说说你今天投了啥..."
              aria-label="给小欧发送消息"
              maxLength={6000}
              disabled={sending || !loaded}
              className="h-9"
            />
            <Button type="button" size="icon" className="size-9 shrink-0" aria-label="发送" disabled={sending || !input.trim()} onClick={() => handleSend()}>
              <Send className="size-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
