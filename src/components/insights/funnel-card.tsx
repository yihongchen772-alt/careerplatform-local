import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { SMALL_SAMPLE_THRESHOLD } from "@/lib/analytics";
import type { FunnelLevel, FunnelOutcomes } from "@/lib/funnel";

/**
 * Shared by both /dashboard (a quick daily glance) and /insights (the full
 * conversion-analysis page) — there is exactly one funnel widget in this
 * app, not two independently-maintained ones. A second implementation
 * briefly existed only in /insights and drifted out of sync with this one
 * (it was missing the OA stage entirely) before being deleted in favor of
 * this shared component.
 */
export function FunnelCard({
  levels,
  total,
  outcomes,
}: {
  levels: FunnelLevel[];
  total: number;
  outcomes?: FunnelOutcomes;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>投递漏斗</CardTitle>
        <p className="text-sm text-muted-foreground">
          每一级是&ldquo;到达过这个阶段&rdquo;的投递数，右侧是相对上一级的转化率——不要求每条
          记录都留下这一关的痕迹，跳过笔试直接进面试的不会被误算成&ldquo;卡在笔试关&rdquo;
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">还没有投递记录</p>
        ) : (
          <>
            {levels.map((level) => (
              <div key={level.stage} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 truncate text-xs text-muted-foreground sm:w-20 sm:text-sm">
                  {STAGE_LABELS[level.stage]}
                </span>
                <div className="h-6 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="h-6 rounded-r-sm bg-primary"
                    style={{ width: `${Math.max(level.shareOfTotal * 100, level.count > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right font-medium tabular-nums">
                  {level.count}
                </span>
                <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {level.stepRate === null
                    ? ""
                    : `${Math.round(level.stepRate * 100)}%`}
                </span>
                {level.smallSample && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    少
                  </Badge>
                )}
              </div>
            ))}
            {outcomes && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                <span>已获 Offer {outcomes.offers}</span>
                <span>已接受 {outcomes.accepted}</span>
                <span>被拒 {outcomes.rejected}</span>
                <span>本人拒绝 {outcomes.declined}</span>
              </div>
            )}
            {levels.some((l) => l.smallSample) && (
              <p className="text-xs text-muted-foreground">
                标&ldquo;少&rdquo;的是这一关不足 {SMALL_SAMPLE_THRESHOLD} 条的，比例波动大。
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
