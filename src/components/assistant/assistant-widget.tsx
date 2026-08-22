"use client";

import { useRef, useState } from "react";
import { Sparkles, X, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAssistant, type AssistantChatMessage } from "@/lib/actions/assistant";

type DisplayMessage = AssistantChatMessage & { id: number };

const SUGGESTIONS = ["我这周有什么要跟进的？", "候选池里哪个岗位最值得投？", "帮我看看简历体检结果"];

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const nextId = useRef(0);

  function addMessage(role: "user" | "assistant", content: string) {
    const id = nextId.current++;
    setMessages((prev) => [...prev, { id, role, content }]);
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
        addMessage("assistant", res.data.reply);
      } else {
        toast.error(res.message);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[28rem] w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-lg border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-medium">AI 助手</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  随便问，比如你这周有什么面试、哪个岗位最值得投、这份简历怎么样。
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
                <div
                  key={m.id}
                  className={
                    m.role === "assistant"
                      ? "rounded-lg bg-muted p-2.5 text-sm"
                      : "rounded-lg bg-primary/10 p-2.5 text-sm"
                  }
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
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
              placeholder="问点什么..."
              disabled={sending}
              className="h-9"
            />
            <Button
              type="button"
              size="icon"
              className="size-9 shrink-0"
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
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </Button>
    </div>
  );
}
