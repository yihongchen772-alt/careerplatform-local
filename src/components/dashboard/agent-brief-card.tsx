"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageCircle, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownText } from "@/components/assistant/markdown-text";
import { generateBrief } from "@/lib/actions/agent-brief";
import { applyAssistantAction } from "@/lib/actions/assistant";
import type { BriefKind, BriefView } from "@/lib/agent/brief";
import { cn } from "@/lib/utils";

const TITLES: Record<BriefKind, string> = { daily: "今日简报", weekly: "周复盘" };

/** Asks the 小欧 window to open with a question typed in (assistant-widget listens). */
export function askXiaoOu(text: string) {
  window.dispatchEvent(new CustomEvent("xiaoou:ask", { detail: text }));
}

/**
 * 小欧 speaking first on 总览: today's brief (and Sunday's review). An owed
 * one is written when the page opens; nothing runs in the background.
 */
export function AgentBriefCard({ daily, weekly, dailyDue, weeklyDue }: { daily: BriefView | null; weekly: BriefView | null; dailyDue: boolean; weeklyDue: boolean }) {
  const router = useRouter();
  const [briefs, setBriefs] = useState<Record<BriefKind, BriefView | null>>({ daily, weekly });
  const [tab, setTab] = useState<BriefKind>(weeklyDue || (weekly && !daily) ? "weekly" : "daily");
  const [writing, setWriting] = useState<BriefKind | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  const started = useRef(false);

  async function write(kind: BriefKind, again = false) {
    setWriting(kind);
    setFailed(null);
    try {
      const res = await generateBrief(kind, again);
      if (!res.ok) { setFailed(res.message); return; }
      setBriefs((prev) => ({ ...prev, [kind]: res.data }));
      setTab(kind);
      router.refresh();
    } finally {
      setWriting(null);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // The review first on a Sunday evening, then the morning brief.
    void (async () => {
      if (weeklyDue) await write("weekly");
      if (dailyDue) await write("daily");
    })();
    // Run once per page open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apply(key: string, index: number) {
    const action = briefs[tab]?.actions[index];
    if (!action) return;
    const res = await applyAssistantAction(action);
    if (!res.ok) return void toast.error(res.message);
    toast.success(res.data.done);
    setApplied((prev) => [...prev, key]);
    router.refresh();
  }

  const brief = briefs[tab];
  if (!brief && !writing && !failed && !dailyDue && !weeklyDue) return null;
  const tabs = (["daily", "weekly"] as const).filter((kind) => briefs[kind] || writing === kind);

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-[image:var(--gradient-accent)] text-primary-foreground shadow-[0_6px_14px_-6px_var(--primary)]"><Sparkles className="size-4" /></span>
          <p className="font-semibold">小欧 · {TITLES[tab]}</p>
          {tabs.length > 1 && (
            <div className="ml-1 flex gap-1 text-xs">
              {tabs.map((kind) => (
                <button key={kind} type="button" onClick={() => setTab(kind)} className={cn("rounded-full px-2 py-0.5", tab === kind ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>{TITLES[kind]}</button>
              ))}
            </div>
          )}
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" disabled={!!writing} onClick={() => write(tab, true)} title="让小欧按最新情况重写"><RefreshCw className="size-3.5" />重新写</Button>
            <Button size="sm" variant="ghost" onClick={() => askXiaoOu(tab === "daily" ? "接着今日简报说：" : "接着周复盘说：")}><MessageCircle className="size-3.5" />接着问小欧</Button>
          </div>
        </div>
        {writing === tab || (writing && !brief) ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />小欧正在看你的投递和日程，写{TITLES[writing]}…</p>
        ) : failed && !brief ? (
          <p className="text-sm text-destructive">{failed}</p>
        ) : brief ? (
          <>
            <MarkdownText text={brief.content} className="text-sm leading-6" />
            {!!brief.actions.length && (
              <div className="flex flex-wrap gap-2 pt-1">
                {brief.actions.map((action, index) => {
                  const key = `${brief.kind}:${brief.period}:${index}`;
                  const done = applied.includes(key);
                  return (
                    <Button key={key} size="sm" variant="outline" disabled={done} onClick={() => apply(key, index)}>
                      {done ? <Check className="size-3.5 text-green-600" /> : <Plus className="size-3.5" />}{action.label}
                    </Button>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">{new Date(brief.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 写的 · 可在设置 → AI 关掉自动简报</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
