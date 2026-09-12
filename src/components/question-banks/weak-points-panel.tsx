"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { startExam, type WeakPoint } from "@/lib/actions/exam";

export function WeakPointsPanel({ points }: { points: WeakPoint[] }) {
  const router = useRouter();
  async function practice(p: WeakPoint) {
    if (!p.bankId) return;
    const res = await startExam({
      bankId: p.bankId,
      modules: [p.module],
      questionTexts: p.lowQuestions.map((q) => q.question),
      count: Math.max(3, Math.min(10, p.questionCount)),
      durationMinutes: Math.max(5, Math.min(30, p.questionCount * 3)),
    });
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    router.push(`/question-banks/exam/${res.data.id}`);
  }
  if (points.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>薄弱环节</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            还没有交过卷的模拟考试，考完几场后这里会自动算出哪些模块最该补
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>薄弱环节</CardTitle>
        <p className="text-sm text-muted-foreground">
          按各模块历史模拟考试平均分从低到高排——最上面的最该优先复习
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {points.map((p) => (
          <div key={`${p.bankId}-${p.module}`} className="space-y-1 rounded-md border p-2">
            <div className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate text-sm">{p.module}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={
                  p.avgScore < 60
                    ? "h-2 rounded-full bg-destructive"
                    : p.avgScore < 80
                      ? "h-2 rounded-full bg-amber-500"
                      : "h-2 rounded-full bg-emerald-500"
                }
                style={{ width: `${Math.max(p.avgScore, 4)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">
              {p.avgScore}
            </span>
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
              {p.questionCount} 题
            </span>
              <Button size="sm" variant="outline" disabled={!p.bankId || p.module === "未分类"} onClick={() => void practice(p)}>
                重练
              </Button>
            </div>
            {p.lowQuestions.length > 0 && (
              <div className="pl-1 text-xs text-muted-foreground">
                低分题：{p.lowQuestions.map((q) => `${q.question}（${q.score}分）`).join("；")}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
