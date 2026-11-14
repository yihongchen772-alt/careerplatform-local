"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  ExternalLink,
  Globe,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  RefreshCw,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { generateInterviewBrief } from "@/lib/actions/interview-brief";
import type { BriefMode, InterviewBrief } from "@/lib/interview-brief";
import { cn } from "@/lib/utils";

type BriefPayload = {
  applicationId: string;
  companyName: string;
  title: string;
  defaultMode: BriefMode;
  resumes: { id: string; name: string; isDefault?: boolean }[];
  defaultResumeId: string | null;
  brief: InterviewBrief | null;
  updatedAt: string | null;
  notes: { id: string; round: string; note: string; date: string; title: string }[];
  questions: { question: string; hint: string }[];
};

export function BriefCramDialog({
  applicationId,
  heading,
  open,
  onOpenChange,
  initialMode,
}: {
  applicationId: string | null;
  heading: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: BriefMode;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [payload, setPayload] = useState<BriefPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<{ id: string; message: string } | null>(null);
  const [resumeId, setResumeId] = useState<string>("");
  const [mode, setMode] = useState<BriefMode>(initialMode ?? "interview");
  const [includeWebSearch, setIncludeWebSearch] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const visiblePayload = applicationId && payload?.applicationId === applicationId ? payload : null;
  const activeError = applicationId && errorMsg?.id === applicationId ? errorMsg.message : null;
  const loading = open && !!applicationId && !visiblePayload && !activeError;

  useEffect(() => {
    if (!open || !applicationId) return;
    let cancelled = false;
    fetch(`/api/applications/${encodeURIComponent(applicationId)}/brief`)
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) {
          const msg = typeof json?.error === "string" ? json.error : "读取考前速览失败";
          setPayload((prev) => (prev?.applicationId === applicationId ? null : prev));
          setErrorMsg({ id: applicationId, message: msg });
          toast.error(msg);
        } else {
          const next = json as BriefPayload;
          setErrorMsg(null);
          setPayload(next);
          setResumeId(next.defaultResumeId ?? next.resumes?.[0]?.id ?? "");
          setMode(initialMode ?? next.brief?.mode ?? next.defaultMode ?? "interview");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPayload((prev) => (prev?.applicationId === applicationId ? null : prev));
        setErrorMsg({ id: applicationId, message: "读取考前速览失败，请检查本地服务状态后重试" });
        toast.error("读取考前速览失败");
      });
    return () => {
      cancelled = true;
    };
  }, [open, applicationId, reloadNonce, initialMode]);

  async function handleGenerate() {
    if (!applicationId) return;
    setGenerating(true);
    try {
      const res = await generateInterviewBrief(applicationId, resumeId || null, {
        mode,
        includeWebSearch,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setPayload((prev) =>
        prev && prev.applicationId === applicationId
          ? { ...prev, brief: res.data, updatedAt: new Date().toISOString() }
          : prev
      );
      toast.success(mode === "exam" ? "笔试抱佛脚速览已生成" : "面试抱佛脚速览已生成");
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  const brief = visiblePayload?.brief ?? null;
  const effectiveMode: BriefMode = brief?.mode ?? mode;
  const isExam = effectiveMode === "exam";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            考前抱佛脚 · {heading}
          </DialogTitle>
          <DialogDescription>
            结合该岗位 JD、选定简历、同公司历史复盘笔记与可选全网真实面经/真题，一页理清考察重点、答题框架与避坑清单。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5 border-b pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" aria-label="准备模式" className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
                {([["interview", "面试速览"], ["exam", "笔试突击"]] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={mode === id}
                    onClick={() => setMode(id)}
                    className={cn(
                      "rounded-md px-2.5 py-1 transition-colors",
                      mode === id ? "bg-card font-medium text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {visiblePayload && visiblePayload.resumes.length > 0 && (
                <NativeSelect
                  aria-label="选择生成速览的简历版本"
                  value={resumeId}
                  onChange={(e) => setResumeId(e.target.value)}
                  className="h-8 max-w-48 text-xs"
                >
                  {visiblePayload.resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      简历：{r.name}
                      {r.isDefault ? "（默认）" : ""}
                    </option>
                  ))}
                </NativeSelect>
              )}
              <Button size="sm" disabled={generating || loading || !!activeError} onClick={() => void handleGenerate()}>
                {generating ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : brief ? (
                  <RefreshCw className="mr-1.5 size-3.5" />
                ) : (
                  <Sparkles className="mr-1.5 size-3.5" />
                )}
                {generating ? "AI 生成中…" : brief ? "重新生成" : mode === "exam" ? "生成笔试抱佛脚" : "生成面试抱佛脚"}
              </Button>
            </div>
            {applicationId && (
              <Link
                href={`/applications/${applicationId}/brief`}
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                独立全屏 / 打印 PDF
                <ExternalLink className="size-3" />
              </Link>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-1.5 select-none">
              <Checkbox checked={includeWebSearch} onCheckedChange={(v) => setIncludeWebSearch(v === true)} />
              <Globe className="size-3.5" />
              <span>生成时联网检索该公司/岗位公开面经与真题线索</span>
            </label>
            <div className="flex items-center gap-1.5">
              {brief?.webUsed && <Badge variant="outline" className="text-[11px]">含全网面经线索</Badge>}
              {visiblePayload?.updatedAt && (
                <Badge variant="secondary" className="text-[11px]">
                  更新于 {new Date(visiblePayload.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="max-h-[56vh] space-y-4 overflow-y-auto pr-1 text-sm">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在加载岗位与面经资料…
            </div>
          ) : activeError ? (
            <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-center">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                {activeError}
              </p>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setErrorMsg(null);
                    setReloadNonce((n) => n + 1);
                  }}
                >
                  重新加载
                </Button>
              </div>
            </div>
          ) : brief ? (
            <>
              {brief.summary && (
                <p className="rounded-xl border border-primary/25 bg-primary/[0.05] px-3.5 py-2.5 text-sm font-medium">
                  {brief.summary}
                </p>
              )}
              <section className="space-y-2 rounded-xl border p-3.5">
                <h3 className="flex items-center gap-1.5 font-semibold">
                  <Target className="size-4 text-primary" />
                  {isExam ? "这场笔试高频考点" : "这一轮看重什么"}
                </h3>
                <ul className="space-y-1.5">
                  {brief.focus.map((item, i) => (
                    <li key={i}>
                      <p className="font-medium">{item.point}</p>
                      <p className="text-xs text-muted-foreground">{item.why}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2 rounded-xl border p-3.5">
                <h3 className="flex items-center gap-1.5 font-semibold">
                  <UserRound className="size-4 text-primary" />
                  {isExam ? "重点复习与开放题答题模板" : "用哪段经历回答"}
                </h3>
                <ul className="space-y-2">
                  {brief.stories.map((item, i) => (
                    <li key={i}>
                      <p className="font-medium">{item.point}</p>
                      <p className="text-xs text-foreground/85">{item.experience}</p>
                      <p className="text-xs text-muted-foreground">{isExam ? "突击口诀 / 模板：" : "讲法："}{item.howToTell}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2 rounded-xl border p-3.5">
                <h3 className="flex items-center gap-1.5 font-semibold">
                  <ListChecks className="size-4 text-primary" />
                  {isExam ? "高频笔试真题与解题思路" : "高频真题与追问思路"}
                </h3>
                <ol className="list-inside list-decimal space-y-1.5">
                  {brief.questions.map((item, i) => (
                    <li key={i}>
                      <span className="font-medium">{item.question}</span>
                      <span className="block pl-5 text-xs text-muted-foreground">{item.hint}</span>
                    </li>
                  ))}
                </ol>
              </section>
              {brief.askBack.length > 0 && (
                <section className="space-y-1.5 rounded-xl border p-3.5">
                  <h3 className="flex items-center gap-1.5 font-semibold">
                    <MessageCircleQuestion className="size-4 text-primary" />
                    {isExam ? "时间分配与得分策略" : "结尾可以反问"}
                  </h3>
                  <ul className="list-inside list-disc space-y-1 text-xs">
                    {brief.askBack.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </section>
              )}
              {brief.reminders.length > 0 && (
                <section className="space-y-1.5 rounded-xl border p-3.5">
                  <h3 className="flex items-center gap-1.5 font-semibold">
                    <CalendarClock className="size-4 text-primary" />
                    临场提醒
                  </h3>
                  <ul className="list-inside list-disc space-y-1 text-xs">
                    {brief.reminders.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-center text-muted-foreground">
              还没有为这场安排生成 AI 速览。点上方「{mode === "exam" ? "生成笔试抱佛脚" : "生成面试抱佛脚"}」，AI 会结合选定简历、该岗位 JD 和你的笔记生成高频考点与真题思路；勾选联网可补充公开面经。
            </div>
          )}

          {visiblePayload && visiblePayload.questions.length > 0 && (
            <section className="space-y-2 rounded-xl border p-3.5">
              <h3 className="flex items-center gap-1.5 font-semibold">
                <ListChecks className="size-4 text-primary" />
                该岗位已保存的预测押题（{visiblePayload.questions.length}）
              </h3>
              <ol className="list-inside list-decimal space-y-1.5">
                {visiblePayload.questions.map((q, i) => (
                  <li key={i}>
                    <span className="font-medium">{q.question}</span>
                    {q.hint && <span className="block pl-5 text-xs text-muted-foreground">{q.hint}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {visiblePayload && visiblePayload.notes.length > 0 && (
            <section className="space-y-2 rounded-xl border p-3.5">
              <h3 className="flex items-center gap-1.5 font-semibold">
                <BookOpen className="size-4 text-primary" />
                你记过的 {visiblePayload.companyName} 历史面经（{visiblePayload.notes.length}）
              </h3>
              <ul className="space-y-1.5">
                {visiblePayload.notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-muted/40 px-2.5 py-2 text-xs">
                    <p className="text-muted-foreground">{n.round} · {n.title}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-foreground">{n.note}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
