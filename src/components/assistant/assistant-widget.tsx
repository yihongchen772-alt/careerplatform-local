"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, X, Send, Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  askAssistant,
  applyAssistantAction,
  type AssistantChatMessage,
} from "@/lib/actions/assistant";
import type { AssistantAction } from "@/lib/assistant-shared";
import type { AgentStep } from "@/lib/agent-loop";

type DisplayMessage = AssistantChatMessage & {
  id: number;
  actions?: AssistantAction[];
  /** Indices of this message's actions already applied, so they don't run twice. */
  applied?: number[];
  steps?: AgentStep[];
};

const HISTORY_KEY = "careerplatform-agent-history-v1";

// Derived from the href itself rather than step.tool: prepare_application
// returns href: "/pool" (agent-tools.ts) when the position has no usable
// entry link at all, and labeling that link "打开网申入口" would be wrong —
// there's nothing to open, it's just a pointer back to the candidate pool.
function hrefLinkLabel(href: string): string {
  if (href.startsWith("/browser")) return "继续准备 / 打开网申入口";
  if (href.startsWith("/resumes")) return "查看简历";
  if (href.startsWith("/pool")) return "查看候选池";
  return "查看详情";
}

// Written as things a student in the middle of 秋招 actually says, not as
// feature names — the second one exists mostly to teach that the assistant
// takes plain "I did X" statements and turns them into records.
const SUGGESTIONS = [
  "结合我的求职进度，安排本周计划和待办",
  "研究我候选池里最值得投的岗位，结合简历分析匹配和不足",
  "帮我准备投递材料，检查缺少的资料并给出网申入口",
  "我刚投了字节的后端开发，帮我记下来",
];

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
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
          .map((m, id) => ({ id, role: m.role, content: m.content.slice(0, 16000) }));
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
      localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-60).map(({ role, content }) => ({ role, content }))));
    } catch { /* Keep the current conversation usable when storage is full. */ }
  }, [messages, loaded]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending, open]);

  function addMessage(
    role: "user" | "assistant",
    content: string,
    actions?: AssistantAction[],
    steps?: AgentStep[]
  ) {
    const id = nextId.current++;
    setMessages((prev) => [...prev.slice(-59), { id, role, content, actions, steps, applied: [] }]);
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busyRef.current || !loaded) return;
    if (content.length > 6000) { toast.error("单条消息请控制在 6000 字以内"); return; }
    busyRef.current = true;
    const history = messages.map(({ role, content }) => ({ role, content }));
    addMessage("user", content);
    setInput("");
    setSending(true);
    try {
      const res = await askAssistant(content, history);
      if (res.ok) {
        addMessage("assistant", res.data.reply, res.data.actions, res.data.steps);
      } else {
        addMessage("assistant", res.message);
      }
    } catch {
      addMessage("assistant", "连接中断，本次请求未完成。请稍后重试。");
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

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[38rem] max-h-[calc(100vh-6rem)] w-[calc(100vw-2rem)] max-w-lg flex-col overflow-hidden rounded-2xl border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex-1"><p className="text-sm font-medium">求职 Agent</p><p className="text-[11px] text-muted-foreground">求职管家 · 岗位研究 · 投递助手</p></div>
            <Button type="button" variant="ghost" size="sm" disabled={sending || !!applying || !loaded} onClick={() => { setMessages([]); nextId.current = 0; }}>新对话</Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="关闭 AI 助手"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  告诉我你想完成的求职任务。我会按需查询记录、联网研究、读取简历摘要，
                  帮你安排计划和准备投递。修改记录需要点击确认，网申提交由你检查后完成。
                  最近 60 条对话保存在本浏览器，点击「新对话」清空。
                </p>
                <Link href="/settings" className="inline-block text-xs text-primary underline">配置 AI 服务商和 API Key</Link>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleSend(s)}
                    className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="space-y-1.5">
                  <div
                    className={
                      m.role === "assistant"
                        ? "rounded-lg bg-muted p-2.5 text-sm"
                        : "rounded-lg bg-primary/10 p-2.5 text-sm"
                    }
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>

                  {!!m.steps?.length && (
                    <details className="rounded-lg border p-2 text-xs" open>
                      <summary className="cursor-pointer font-medium">工具执行记录 · {m.steps.length} 步</summary>
                      <ol className="mt-2 space-y-2">
                        {m.steps.map((step, index) => <li key={index}>
                          <p className={step.status === "error" ? "text-destructive" : "font-medium"}>{index + 1}. {step.label} · {step.status === "error" ? "未完成" : "完成"}</p>
                          <p className="mt-0.5 text-muted-foreground">{step.summary}</p>
                          {step.href && <Link href={step.href} onClick={() => setOpen(false)} className="text-primary underline">{hrefLinkLabel(step.href)}</Link>}
                        </li>)}
                      </ol>
                    </details>
                  )}

                  {m.actions?.map((action, i) => {
                    const done = m.applied?.includes(i);
                    const busy = applying === `${m.id}:${i}`;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={done || !!applying}
                        onClick={() => handleApply(m.id, i, action)}
                        className="flex w-full items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-left text-xs transition-colors enabled:hover:bg-muted disabled:opacity-70"
                      >
                        {done ? (
                          <Check className="size-3.5 shrink-0 text-green-600" />
                        ) : (
                          <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          {action.label}
                          {/* The label says things like "下周三", but what
                              gets written is the date the model resolved
                              that to — and it does get that wrong. Show the
                              real value so a bad one is caught before the
                              click, not after. */}
                          {action.date && (
                            <span className="ml-1 text-muted-foreground">（{action.date}）</span>
                          )}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {done ? "已保存" : busy ? "保存中..." : "点击保存"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
            {sending && <p role="status" className="text-xs text-muted-foreground">正在分析任务并按需调用工具，研究任务可能需要几分钟...</p>}
            <div ref={bottomRef} />
          </div>

          <div className="flex items-center gap-2 border-t p-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSend();
              }}
              placeholder="问点什么，或说说你今天投了啥..."
              aria-label="给求职 Agent 发送消息"
              maxLength={6000}
              disabled={sending || !loaded}
              className="h-9"
            />
            <Button
              type="button"
              size="icon"
              className="size-9 shrink-0"
              aria-label="发送"
              disabled={sending || !input.trim()}
              onClick={() => handleSend()}
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <Button
        type="button"
        size="icon"
        className="size-12 rounded-full shadow-lg"
        aria-label={open ? "关闭 AI 助手" : "打开 AI 助手"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </Button>
    </div>
  );
}
