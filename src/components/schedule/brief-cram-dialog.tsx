"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ExternalLink, ListChecks, Loader2, MessageCircleQuestion, RefreshCw, Sparkles, Target, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateInterviewBrief } from "@/lib/actions/interview-brief";
import type { InterviewBrief } from "@/lib/interview-brief";

type BriefPayload = {
  applicationId: string;
  companyName: string;
  title: string;
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
}: {
  applicationId: string | null;
  heading: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [payload, setPayload] = useState<BriefPayload | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const loading = open && !!applicationId && payload?.applicationId !== applicationId && errorId !== applicationId;

  useEffect(() => {
    if (!open || !applicationId) return;
    let active = true;
    fetch(`/api/applications/${encodeURIComponent(applicationId)}/brief`)
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!active) return;
        if (!ok) {
          setErrorId(applicationId);
          toast.error(json.error ?? "读取面经速览失败");
        } else {
          setErrorId(null);
          setPayload(json as BriefPayload);
        }
      })
      .catch(() => {
        if (active) {
          setErrorId(applicationId);
          toast.error("读取面经速览失败");
        }
      });
    return () => {
      active = false;
    };
  }, [open, applicationId]);

  async function handleGenerate() {
    if (!applicationId) return;
    setGenerating(true);
    try {
      const res = await generateInterviewBrief(applicationId, null);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setPayload((prev) =>
        prev
          ? { ...prev, brief: res.data, updatedAt: new Date().toISOString() }
          : null
      );
      toast.success("考前抱佛脚速览已生成");
      router.refresh();
    } finally {
      setGenerating(false);
    }
  }

  const brief = payload?.brief ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            考前抱佛脚 · {heading}
          </DialogTitle>
          <DialogDescription>
            结合该岗位 JD、你的真实简历与同公司历史面经，一页看清考察重点、答题故事线和高频追问。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={generating || loading} onClick={() => void handleGenerate()}>
              {generating ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : brief ? (
                <RefreshCw className="mr-1.5 size-3.5" />
              ) : (
                <Sparkles className="mr-1.5 size-3.5" />
              )}
              {generating ? "AI 生成中（约 20 秒）…" : brief ? "重新生成" : "立即生成考前抱佛脚"}
            </Button>
            {payload?.updatedAt && (
              <Badge variant="secondary" className="text-[11px]">
                更新于 {new Date(payload.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </Badge>
            )}
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

        <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1 text-sm">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在加载岗位与面经资料…
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
                  这一轮看重什么
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
                  用哪段经历回答
                </h3>
                <ul className="space-y-2">
                  {brief.stories.map((item, i) => (
                    <li key={i}>
                      <p className="font-medium">{item.point}</p>
                      <p className="text-xs text-foreground/85">{item.experience}</p>
                      <p className="text-xs text-muted-foreground">讲法：{item.howToTell}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2 rounded-xl border p-3.5">
                <h3 className="flex items-center gap-1.5 font-semibold">
                  <ListChecks className="size-4 text-primary" />
                  高频真题与追问思路
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
                    结尾可以反问
                  </h3>
                  <ul className="list-inside list-disc space-y-1 text-xs">
                    {brief.askBack.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-center text-muted-foreground">
              还没有为这场面试生成 AI 速览。点上方「立即生成考前抱佛脚」，AI 会结合你的简历经历和该岗位 JD 整理答题要点与追问预测。
            </div>
          )}

          {payload && payload.notes.length > 0 && (
            <section className="space-y-2 rounded-xl border p-3.5">
              <h3 className="flex items-center gap-1.5 font-semibold">
                <BookOpen className="size-4 text-primary" />
                你记过的 {payload.companyName} 历史面经（{payload.notes.length}）
              </h3>
              <ul className="space-y-1.5">
                {payload.notes.map((n) => (
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
