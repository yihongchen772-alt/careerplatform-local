"use client";

import { useRef, useState } from "react";
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

type DisplayMessage = AssistantChatMessage & {
  id: number;
  actions?: AssistantAction[];
  /** Indices of this message's actions already applied, so they don't run twice. */
  applied?: number[];
};

// Written as things a student in the middle of 秋招 actually says, not as
// feature names — the second one exists mostly to teach that the assistant
// takes plain "I did X" statements and turns them into records.
const SUGGESTIONS = [
  "今天该做什么？",
  "我刚投了字节的后端开发",
  "候选池和信息库里，接下来最该投哪个？",
  "哪些岗位快截止了？",
];

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const nextId = useRef(0);

  function addMessage(
    role: "user" | "assistant",
    content: string,
    actions?: AssistantAction[]
  ) {
    const id = nextId.current++;
    setMessages((prev) => [...prev, { id, role, content, actions, applied: [] }]);
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    addMessage("user", content);
    setInput("");
    setSending(true);
    try {
      const res = await askAssistant(content, history);
      if (res.ok) {
        addMessage("assistant", res.data.reply, res.data.actions);
      } else {
        toast.error(res.message);
      }
    } finally {
      setSending(false);
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
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[32rem] max-h-[calc(100vh-6rem)] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-lg border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-medium">AI 助手</p>
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
                  它看得到你的候选池、投递记录、秋招信息库和待办。可以问它该投哪个、
                  什么快截止了；也可以直接说你干了什么（&ldquo;我投了美团数据分析，下周三一面&rdquo;），
                  它会整理成记录让你一键存下来。
                </p>
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
            {sending && <p className="text-xs text-muted-foreground">思考中...</p>}
          </div>

          <div className="flex items-center gap-2 border-t p-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSend();
              }}
              placeholder="问点什么，或说说你今天投了啥..."
              disabled={sending}
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
