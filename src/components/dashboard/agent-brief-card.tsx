"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageCircle, Plus, RefreshCw, Sparkles, Zap, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownText } from "@/components/assistant/markdown-text";
import { generateBrief } from "@/lib/actions/agent-brief";
import { applyAssistantAction } from "@/lib/actions/assistant";
import { launchBatchApply } from "@/lib/batch-apply";
import type { BriefKind, BriefView, ProactiveNudge } from "@/lib/agent/brief";
import type { AgentMode } from "@/lib/agent/modes";
import { cn } from "@/lib/utils";

const TITLES: Record<BriefKind, string> = { daily: "今日简报", weekly: "周复盘" };

/** Asks the 小欧 window to open with a question (and optional expert mode + auto-send). */
export function askXiaoOu(input: string | { text: string; mode?: AgentMode; send?: boolean }) {
  window.dispatchEvent(new CustomEvent("xiaoou:ask", { detail: input }));
}

/**
 * 小欧 speaking first on 总览: today's brief (and Sunday's review) plus
 * zero-cost event-driven proactive radar nudges.
 */
export function AgentBriefCard({ daily, weekly, dailyDue, weeklyDue, nudges = [] }: { daily: BriefView | null; weekly: BriefView | null; dailyDue: boolean; weeklyDue: boolean; nudges?: ProactiveNudge[] }) {
  const router = useRouter();
  const [briefs, setBriefs] = useState<Record<BriefKind, BriefView | null>>({ daily, weekly });
  const [tab, setTab] = useState<BriefKind>(weeklyDue || (weekly && !daily) ? "weekly" : "daily");
  const [writing, setWriting] = useState<BriefKind | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  const [busyNudge, setBusyNudge] = useState<string | null>(null);
  const [doneNudges, setDoneNudges] = useState<string[]>([]);
  // Long briefs open folded to their first lines; the buttons stay in view.
  const [expanded, setExpanded] = useState(false);
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
    if (res.data.batchJobs?.length) {
      await launchBatchApply(res.data.batchJobs, (href) => router.push(href));
    }
    toast.success(res.data.done);
    setApplied((prev) => [...prev, key]);
    router.refresh();
  }

  async function runNudge(nudge: ProactiveNudge) {
    if (nudge.action.kind === "link") {
      router.push(nudge.action.href);
      return;
    }
    if (nudge.action.kind === "ask_xiaoou") {
      askXiaoOu({ text: nudge.action.prompt, mode: nudge.action.mode, send: nudge.action.send ?? true });
      return;
    }
    if (nudge.action.kind === "generate_brief") {
      setBusyNudge(nudge.id);
      try {
        const res = await applyAssistantAction({
          type: "generate_interview_brief",
          label: nudge.ctaLabel,
          targetId: nudge.action.applicationId,
        });
        if (!res.ok) {
          toast.error(res.message);
          return;
        }
        toast.success(res.data.done);
        setDoneNudges((prev) => [...prev, nudge.id]);
        if (res.data.href) router.push(res.data.href);
        else router.refresh();
      } finally {
        setBusyNudge(null);
      }
    }
  }

  const brief = briefs[tab];
  const activeNudges = nudges.filter((n) => !doneNudges.includes(n.id));
  if (!brief && !writing && !failed && !dailyDue && !weeklyDue && !activeNudges.length) return null;
  const tabs = (["daily", "weekly"] as const).filter((kind) => briefs[kind] || writing === kind);

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="size-4" /></span>
          <p className="font-semibold">小欧 · {brief || writing || dailyDue || weeklyDue ? TITLES[tab] : "主动雷达"}</p>
          {tabs.length > 1 && (
            <div className="ml-1 flex gap-1 text-xs">
              {tabs.map((kind) => (
                <button key={kind} type="button" onClick={() => setTab(kind)} className={cn("rounded-full px-2 py-0.5", tab === kind ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground")}>{TITLES[kind]}</button>
              ))}
            </div>
          )}
          <div className="ml-auto flex gap-1">
            {(brief || dailyDue || weeklyDue) && (
              <Button size="sm" variant="ghost" disabled={!!writing} onClick={() => write(tab, true)} title="让小欧按最新情况重写"><RefreshCw className="size-3.5" />重新写</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => askXiaoOu(brief ? (tab === "daily" ? "接着今日简报说：" : "接着周复盘说：") : "帮我看看今天最要紧的事是什么？")}><MessageCircle className="size-3.5" />接着问小欧</Button>
          </div>
        </div>
        {!!activeNudges.length && (
          <div className="space-y-1.5 rounded-xl border border-primary/20 bg-primary/[0.03] p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
              <Zap className="size-3.5" />
              主动备战与风险雷达（{activeNudges.length}）
            </p>
            <div className="space-y-1.5">
              {activeNudges.slice(0, 3).map((nudge) => {
                const running = busyNudge === nudge.id;
                return (
                  <div key={nudge.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card/80 px-2.5 py-1.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className={cn("font-medium", nudge.urgency === "high" ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>{nudge.title}</p>
                      <p className="text-muted-foreground">{nudge.detail}</p>
                    </div>
                    <Button size="sm" variant={nudge.urgency === "high" ? "default" : "outline"} className="h-7 shrink-0 text-xs" disabled={!!busyNudge} onClick={() => void runNudge(nudge)}>
                      {running ? <><Loader2 className="size-3 animate-spin" />生成中…</> : <>{nudge.ctaLabel}<ArrowRight className="size-3" /></>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {writing === tab || (writing && !brief) ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />小欧正在看你的投递和日程，写{TITLES[writing]}…</p>
        ) : failed && !brief ? (
          <p className="text-sm text-destructive">{failed}</p>
        ) : brief ? (
          <>
            {(() => {
              const long = brief.content.length > 260 || brief.content.split("\n").filter((line) => line.trim()).length > 7;
              return (
                <div className="relative">
                  <div className={cn(long && !expanded && "max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]")}>
                    <MarkdownText text={brief.content} className="text-sm leading-6" />
                  </div>
                  {long && <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开全文"}</button>}
                </div>
              );
            })()}
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
            <p className="text-xs text-muted-foreground">{new Date(brief.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 写的 · 可在设置 → AI 关掉自动简报</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
