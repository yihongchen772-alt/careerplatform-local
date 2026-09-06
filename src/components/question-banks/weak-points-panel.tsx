import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WeakPoint } from "@/lib/actions/exam";

/** Pure display — no navigation into a specific bank/module, since modules
 * are scoped per-bank in this app (no cross-bank module URL to link to). */
export function WeakPointsPanel({ points }: { points: WeakPoint[] }) {
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
          <div key={p.module} className="flex items-center gap-3">
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
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
