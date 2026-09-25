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
    <Card className="rounded-[1.5rem] border-border/65 bg-card/75 shadow-[0_16px_45px_-38px_rgba(0,0,0,0.55)] backdrop-blur-xl">
      <CardHeader>
        <CardTitle>阶段覆盖</CardTitle>
        <p className="text-sm text-muted-foreground">
          只统计实际记录过的阶段。企业顺序不同、跳过的环节不会被虚算进去。
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
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-[image:var(--gradient-accent)]"
                    style={{ width: `${Math.max(level.shareOfTotal * 100, level.count > 0 ? 2 : 0)}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right font-medium tabular-nums">
                  {level.count}
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
