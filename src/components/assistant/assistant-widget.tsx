"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, X, Send, Check, Plus, Maximize2, Minimize2, Loader2, CircleAlert, CircleCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { applyAssistantAction } from "@/lib/actions/assistant";
import { addAgentMemory, deleteAgentMemory, getAgentState, saveAgentPlan, type AgentState } from "@/lib/actions/agent-memory";
import type { AssistantAction, AssistantChatMessage } from "@/lib/assistant-shared";
import type { AgentStep } from "@/lib/agent/run";
import { VoiceInput } from "./voice-input";
import { MarkdownText } from "./markdown-text";

type DisplayMessage = AssistantChatMessage & {
  id: number;
  actions?: AssistantAction[];
  /** Indices of this message's actions already applied, so they don't run twice. */
  applied?: number[];
  steps?: AgentStep[];
  /** Backup models used this turn ("…过载，改用 …"). */
  notices?: string[];
  failedRequest?: { message: string; history: AssistantChatMessage[] };
};

type TurnResult = { ok: true; reply: string; actions: AssistantAction[]; steps: AgentStep[]; notices: string[] } | { ok: false; message: string };
type Tab = "chat" | "plan" | "memory";

const HISTORY_KEY = "careerplatform-agent-history-v1";

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
const SUGGESTIONS = [
  "帮我规划这周：先做什么、投哪些、准备哪场面试",
  "比较一下我候选池里最值得投的几个岗位，给个结论",
  "按我的方向和意向城市，去官网找几个新岗位",
  "我刚面完腾讯二面，问了项目难点和一道 SQL，帮我记下来",
];

/** One tap, any time — the questions asked most during 秋招. */
const QUICK_QUESTIONS = [
  "今天有什么安排？",
  "帮我规划这周",
  "帮我准备下一场面试",
  "哪些该跟进了？",
  "帮我找新岗位",
];

function StepLine({ step, onNavigate }: { step: AgentStep; onNavigate: () => void }) {
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
async function streamTurn(message: string, history: AssistantChatMessage[], onEvent: (event: { type: string; step?: AgentStep; text?: string }) => void): Promise<TurnResult> {
  const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, history }) });
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
      if (event.type === "done") return { ok: true, reply: event.reply, actions: event.actions ?? [], steps: event.steps ?? [], notices: event.notices ?? [] };
      if (event.type === "error") return { ok: false, message: event.message };
      onEvent(event);
    }
    if (done) return { ok: false, message: "连接中断，本次请求未完成。请稍后重试。" };
  }
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
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

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
      if (Array.isArray(raw)) {
        const restored: DisplayMessage[] = raw.slice(-60)
          .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
          .map((m, id) => ({ id, role: m.role, content: m.content.slice(0, 16000), failedRequest: m.failedRequest && typeof m.failedRequest.message === "string" && Array.isArray(m.failedRequest.history) ? { message: m.failedRequest.message.slice(0, 6000), history: m.failedRequest.history.filter((h: AssistantChatMessage) => h && ["user", "assistant"].includes(h.role) && typeof h.content === "string").slice(-60) } : undefined }));
        // Restore only text. Old operation cards must not be replayed after a reload.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate browser-only persisted history after SSR
        setMessages(restored);
        nextId.current = restored.length;
      }
    } catch { /* A corrupt history must not prevent opening the assistant. */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-60).map(({ role, content, failedRequest }) => ({ role, content, failedRequest }))));
    } catch { /* Keep the current conversation usable when storage is full. */ }
  }, [messages, loaded]);

  useEffect(() => {
    if (tab === "chat") bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, live, sending, open, tab]);

  async function loadState() {
    const res = await getAgentState();
    if (res.ok) setState(res.data);
    else toast.error(res.message);
  }

  function openTab(next: Tab) {
    setTab(next);
    setPlanDraft(null);
    if (next !== "chat") void loadState();
  }

  function addMessage(role: "user" | "assistant", content: string, actions?: AssistantAction[], steps?: AgentStep[], notices?: string[]) {
    const id = nextId.current++;
    setMessages((prev) => [...prev.slice(-59), { id, role, content, actions, steps, notices, applied: [] }]);
  }

  async function runTurn(content: string, history: AssistantChatMessage[]): Promise<TurnResult> {
    setLive({ steps: [], note: "" });
    try {
      return await streamTurn(content, history, (event) => {
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
      setMessages((prev) => prev.map((m) => m.id !== message.id ? m : res.ok
        ? { id: m.id, role: "assistant", content: res.reply, actions: res.actions, steps: res.steps, notices: res.notices, applied: [] }
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
      if (res.ok) addMessage("assistant", res.reply, res.actions, res.steps, res.notices);
      else {
        // A failed call should be noticed even with the window scrolled away.
        toast.error(res.message);
        const id = nextId.current++;
        setMessages((prev) => [...prev.slice(-59), { id, role: "assistant", content: res.message, failedRequest: { message: content, history } }]);
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
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, applied: [...(m.applied ?? []), index] } : m
        )
      );
      addMessage("assistant", `操作已完成：${res.data.done}`);
    } catch {
      toast.error("未能确认保存结果，请先检查记录再重试。");
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

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <div role="dialog" aria-label="小欧求职助手" className={`flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xl ${wide ? "h-[calc(100vh-6rem)] w-[calc(100vw-2rem)] max-w-4xl" : "h-[38rem] max-h-[calc(100vh-6rem)] w-[calc(100vw-2rem)] max-w-lg"}`}>
          <div className="flex items-center gap-1 border-b px-3 py-2">
            <div className="flex-1"><p className="text-sm font-medium">小欧</p><p className="text-[11px] text-muted-foreground">求职 agent · 规划决策 · 找岗位 · 记录进展</p></div>
            {tab === "chat" && <Button type="button" variant="ghost" size="sm" disabled={sending || !!applying || !loaded} onClick={() => { setMessages([]); nextId.current = 0; }}>新对话</Button>}
            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={wide ? "缩小" : "放大"} onClick={() => setWide((v) => !v)}>
              {wide ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
            <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="关闭小欧" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex gap-1 border-b px-3 py-1.5 text-xs" role="tablist">
            {([["chat", "对话"], ["plan", "求职计划"], ["memory", "小欧的记忆"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => openTab(id)} className={`rounded-full px-2.5 py-1 ${tab === id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
            ))}
          </div>

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
                <p className="text-sm text-muted-foreground">
                  把求职的事交给我：我会自己查你的记录、读 JD 和简历、上官网找岗位、联网研究，然后给你明确的建议和计划。
                  要改记录时我会给出按钮，你点了才保存；我不会替你发邮件或提交网申。
                </p>
                <Link href="/settings" className="inline-block text-xs text-primary underline">配置 AI 服务商和 API Key</Link>
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => handleSend(s)} className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted">{s}</button>
                ))}
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="space-y-1.5">
                  <div className={m.failedRequest ? "rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm" : m.role === "assistant" ? "rounded-lg bg-muted p-2.5 text-sm" : "rounded-lg bg-primary/10 p-2.5 text-sm"}>
                    {m.role === "assistant" && !m.failedRequest ? <MarkdownText text={m.content} /> : <p className="whitespace-pre-wrap">{m.failedRequest && <CircleAlert className="mr-1 inline size-3.5 -translate-y-px text-destructive" />}{m.content}</p>}
                    {m.failedRequest && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={sending || !!applying} onClick={() => retryMessage(m)}>重新发送</Button>
                        <Link href="/settings" onClick={() => setOpen(false)} className="inline-flex h-8 items-center rounded-md px-2 text-xs text-primary underline">去设置换模型</Link>
                      </div>
                    )}
                  </div>
                  {!!m.notices?.length && <p className="px-1 text-[11px] text-amber-600 dark:text-amber-400">{m.notices.join("；")}</p>}

                  {!!m.steps?.length && (
                    <details className="rounded-lg border p-2 text-xs">
                      <summary className="cursor-pointer font-medium">做了 {m.steps.length} 步{m.steps.some((step) => step.status === "error") ? `（${m.steps.filter((step) => step.status === "error").length} 步没成）` : ""}</summary>
                      <ol className="mt-2 space-y-1.5">{m.steps.map((step) => <StepLine key={step.id} step={step} onNavigate={() => setOpen(false)} />)}</ol>
                    </details>
                  )}

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
                {!!live.steps.length && <ol className="mt-2 space-y-1.5">{live.steps.map((step) => <StepLine key={step.id} step={step} onNavigate={() => setOpen(false)} />)}</ol>}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-1.5 overflow-x-auto border-t px-2 pt-2 [scrollbar-width:none]">
            {QUICK_QUESTIONS.map((question) => (
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
      )}

      <Button type="button" size="icon" className="size-12 rounded-full shadow-lg" aria-label={open ? "关闭小欧" : "打开小欧"} onClick={() => setOpen((v) => !v)}>
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </Button>
    </div>
  );
}
