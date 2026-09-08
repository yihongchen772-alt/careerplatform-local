import { TrendingUp } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkillGapCard } from "@/components/insights/skill-gap-card";
import {
  computeConversion,
  computeFunnel,
  formatPercent,
  SMALL_SAMPLE_THRESHOLD,
  type ConversionRow,
  type FunnelStep,
} from "@/lib/analytics";
import type { SkillGapAnalysis } from "@/lib/actions/skill-gap";

export default async function InsightsPage() {
  const user = await requireUser();

  const [applications, resumeVersions, skillGaps] = await Promise.all([
    db.application.findMany({
      where: { userId: user.id },
      include: {
        resumeVersion: { select: { name: true } },
        position: { select: { track: true } },
        stageHistory: { select: { stage: true } },
      },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
    }),
    db.skillGapAnalysis.findMany({
      where: { userId: user.id },
      select: { resumeVersionId: true, result: true },
    }),
  ]);
  const defaultResumeVersionId = resumeVersions.find((r) => r.isDefault)?.id ?? null;
  const skillGapResults = Object.fromEntries(
    skillGaps.map((s) => [s.resumeVersionId, s.result as SkillGapAnalysis])
  );

  const { bySource, byResume, byTrack } = computeConversion(applications);
  const funnel = computeFunnel(applications);
  // The funnel only needs applications to exist at all — unlike the three
  // grouped cards below, it doesn't depend on source/resume/track being
  // filled in, so it must not be hidden by the same "no grouped data yet"
  // check (an account with plenty of ungrouped applications would otherwise
  // never see it).
  const hasApplications = applications.length > 0;
  const hasGrouped =
    bySource.length > 0 || byResume.length > 0 || byTrack.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">投递转化率</h1>
        <p className="text-sm text-muted-foreground">
          看看哪个渠道、哪版简历、哪个方向更容易拿到面试，好决定精力往哪放
        </p>
      </div>

      {!hasApplications ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <TrendingUp className="size-8 text-muted-foreground/50" />
          <span className="text-sm">
            还没有足够的数据。加几条投递记录，这里就会有分析
          </span>
        </div>
      ) : (
        <>
          <FunnelCard steps={funnel} />
          {hasGrouped ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <ConversionCard title="按渠道" rows={bySource} emptyHint="投递记录里还没填渠道" />
              <ConversionCard title="按简历版本" rows={byResume} emptyHint="投递时还没关联简历版本" />
              <ConversionCard title="按岗位方向" rows={byTrack} emptyHint="从候选池标记已投的记录才带方向" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              投递记录里填了渠道、简历版本、岗位方向，这里还会有更细的对比
            </p>
          )}
        </>
      )}

      {/* Depends on Position.jdText, not Application data — kept outside the
          hasApplications gate above so it works before you've applied to
          anything, purely off what's sitting in the candidate pool. */}
      <SkillGapCard
        resumeVersions={resumeVersions}
        defaultResumeVersionId={defaultResumeVersionId}
        initialResults={skillGapResults}
      />
    </div>
  );
}

function FunnelCard({ steps }: { steps: FunnelStep[] }) {
  const total = steps[0]?.reached ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">分阶段转化漏斗</CardTitle>
        <p className="text-sm text-muted-foreground">
          每一步之间的通过率——看看具体卡在哪一关，不是笼统的&ldquo;进面率&rdquo;
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((s) => {
          const widthPct = total > 0 ? Math.max((s.reached / total) * 100, 2) : 0;
          return (
            <div key={s.stage} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-16 shrink-0 font-medium">{s.label}</span>
                <span className="text-muted-foreground">{s.reached} 条</span>
                {s.dropRate !== null && (
                  <span className="text-xs text-muted-foreground">
                    （上一关通过 {formatPercent(1 - s.dropRate)}）
                  </span>
                )}
                {s.smallSample && (
                  <Badge variant="outline" className="text-xs">
                    样本少
                  </Badge>
                )}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          统计口径是&ldquo;走到过这一关或更远&rdquo;，不要求每条记录都留下这一关的记录——
          有些岗位没有笔试、直接进面试，不会被误算成&ldquo;卡在笔试关&rdquo;。
          标了&ldquo;样本少&rdquo;的是这一关不足 {SMALL_SAMPLE_THRESHOLD} 条的，比例波动大。
        </p>
      </CardContent>
    </Card>
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
