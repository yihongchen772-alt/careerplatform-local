"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { submitExam, type ExamDetail } from "@/lib/actions/exam";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ExamRunner({ exam }: { exam: ExamDetail }) {
  const router = useRouter();

  if (exam.status === "ENDED") return <ExamResults exam={exam} />;
  return <ExamTaking exam={exam} onSubmitted={() => router.refresh()} />;
}

function ExamTaking({ exam, onSubmitted }: { exam: ExamDetail; onSubmitted: () => void }) {
  const [answers, setAnswers] = useState<string[]>(() => exam.questions.map(() => ""));
  // Deadline derived from the exam's own createdAt rather than "now +
  // duration" — it's the same value on every render (createdAt/duration
  // are immutable props for a given exam), so recomputing it is harmless
  // and avoids reading a ref during render.
  const deadline = new Date(exam.createdAt).getTime() + exam.durationMinutes * 60000;
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((deadline - Date.now()) / 1000))
  );
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);
  // The auto-submit timer's closure is created once at mount (see the
  // effect below) and would otherwise call handleSubmit with whatever
  // `answers` looked like at that moment — i.e. all blank. Mirroring the
  // latest value into a ref lets handleSubmit always read what's actually
  // on screen, not a stale mount-time snapshot.
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  async function handleSubmit(auto = false) {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const payload = answersRef.current.map((answer, index) => ({ index, answer }));
      const res = await submitExam(exam.id, payload);
      if (!res.ok) {
        toast.error(res.message);
        submittedRef.current = false;
        return;
      }
      toast.success(auto ? `时间到，已自动交卷 · ${res.data.overallScore} 分` : `已交卷 · ${res.data.overallScore} 分`);
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        void handleSubmit(true);
      }
    }, 1000);
    return () => clearInterval(t);
    // deadline is derived from immutable props (same value every render for
    // this exam), and handleSubmit/answers are read via the functional
    // setState form below — re-subscribing the interval every render would
    // just restart the same countdown, so the deps list is deliberately
    // narrow to the one value that can actually change across renders of a
    // *different* exam (it can't, here, but this is the honest dependency).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);

  const answeredCount = answers.filter((a) => a.trim()).length;
  const low = remaining <= 60;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-lg border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">
            {exam.bankName}
            {exam.modules && exam.modules.length > 0 && ` · ${exam.modules.join("/")}`}
          </span>
          <Badge variant="secondary">
            已答 {answeredCount}/{exam.questions.length}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`flex items-center gap-1 text-sm font-medium tabular-nums ${
              low ? "text-destructive" : ""
            }`}
          >
            <Clock className="size-4" />
            {formatClock(remaining)}
          </span>
          <Button size="sm" disabled={submitting} onClick={() => handleSubmit(false)}>
            <Send className="mr-1.5 size-4" />
            {submitting ? "提交中..." : "交卷"}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {exam.questions.map((q, i) => (
          <Card key={i}>
            <CardContent className="space-y-2 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {i + 1}. {q.question}
                </span>
                {q.module && (
                  <Badge variant="outline" className="text-xs">
                    {q.module}
                  </Badge>
                )}
              </div>
              <Textarea
                value={answers[i]}
                onChange={(e) =>
                  setAnswers((prev) => prev.map((a, idx) => (idx === i ? e.target.value : a)))
                }
                rows={4}
                placeholder="在这里作答..."
                disabled={submitting}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Button disabled={submitting} onClick={() => handleSubmit(false)}>
        <Send className="mr-1.5 size-4" />
        {submitting ? "提交中..." : "交卷"}
      </Button>
    </div>
  );
}

function ExamResults({ exam }: { exam: ExamDetail }) {
  const pass = exam.overallScore != null && exam.overallScore >= 60;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums">{exam.overallScore}</span>
            <span className="text-sm text-muted-foreground">/ 100</span>
            <Badge variant={pass ? "default" : "destructive"}>{pass ? "及格" : "不及格"}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {exam.bankName}
            {exam.modules && exam.modules.length > 0 && ` · ${exam.modules.join("/")}`}
            {` · ${exam.questions.length} 题`}
          </p>
          {exam.summary && <p className="text-sm">{exam.summary}</p>}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {exam.questions.map((q, i) => {
          const a = exam.answers?.[i];
          return (
            <Card key={i}>
              <CardContent className="space-y-2 pt-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="font-medium">
                    {i + 1}. {q.question}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {q.module && (
                      <Badge variant="outline" className="text-xs">
                        {q.module}
                      </Badge>
                    )}
                    <Badge variant={a && a.score >= 60 ? "secondary" : "destructive"}>
                      {a?.score ?? 0} 分
                    </Badge>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">你的作答</p>
                  <p className="whitespace-pre-wrap">
                    {a?.answer || <span className="text-muted-foreground">（空白）</span>}
                  </p>
                </div>
                {a?.feedback && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">反馈</p>
                    <p className="text-muted-foreground">{a.feedback}</p>
                  </div>
                )}
                {q.referenceAnswer && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">参考答案</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{q.referenceAnswer}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
