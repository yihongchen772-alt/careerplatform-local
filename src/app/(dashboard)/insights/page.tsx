import { TrendingUp } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  computeConversion,
  formatPercent,
  SMALL_SAMPLE_THRESHOLD,
  type ConversionRow,
} from "@/lib/analytics";

export default async function InsightsPage() {
  const user = await requireUser();

  const applications = await db.application.findMany({
    where: { userId: user.id },
    include: {
      resumeVersion: { select: { name: true } },
      position: { select: { track: true } },
      stageHistory: { select: { stage: true } },
    },
  });

  const { bySource, byResume, byTrack } = computeConversion(applications);
  const hasAny =
    bySource.length > 0 || byResume.length > 0 || byTrack.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">投递转化率</h1>
        <p className="text-sm text-muted-foreground">
          看看哪个渠道、哪版简历、哪个方向更容易拿到面试，好决定精力往哪放
        </p>
      </div>

      {!hasAny ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <TrendingUp className="size-8 text-muted-foreground/50" />
          <span className="text-sm">
            还没有足够的数据。投递记录里填了渠道、简历版本，这里就会有对比
          </span>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <ConversionCard title="按渠道" rows={bySource} emptyHint="投递记录里还没填渠道" />
          <ConversionCard title="按简历版本" rows={byResume} emptyHint="投递时还没关联简历版本" />
          <ConversionCard title="按岗位方向" rows={byTrack} emptyHint="从候选池标记已投的记录才带方向" />
        </div>
      )}
    </div>
  );
}

function ConversionCard({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: ConversionRow[];
  emptyHint: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        )}
        {rows.map((r) => (
          <div key={r.key} className="space-y-1 border-b pb-3 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.key}</span>
              <span className="text-xs text-muted-foreground">
                投递 {r.total}
              </span>
              {r.smallSample && (
                <Badge variant="outline" className="text-xs">
                  样本少
                </Badge>
              )}
            </div>
            <div className="flex gap-4 text-sm">
              <span>
                <span className="text-muted-foreground">进面 </span>
                <span className="font-medium">{formatPercent(r.engagedRate)}</span>
                <span className="text-xs text-muted-foreground"> ({r.engaged})</span>
              </span>
              <span>
                <span className="text-muted-foreground">Offer </span>
                <span className="font-medium">{formatPercent(r.offerRate)}</span>
                <span className="text-xs text-muted-foreground"> ({r.offers})</span>
              </span>
            </div>
          </div>
        ))}
        {rows.some((r) => r.smallSample) && (
          <p className="text-xs text-muted-foreground">
            标了&ldquo;样本少&rdquo;的是投递不足 {SMALL_SAMPLE_THRESHOLD} 条的分组，
            比例波动大，别急着据此下结论
          </p>
        )}
      </CardContent>
    </Card>
  );
}
