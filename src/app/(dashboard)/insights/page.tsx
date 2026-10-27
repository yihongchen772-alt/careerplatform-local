import { TrendingUp } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkillGapCard } from "@/components/insights/skill-gap-card";
import { FunnelCard } from "@/components/insights/funnel-card";
import { ResumeComparisonCard } from "@/components/insights/resume-comparison-card";
import {
  bestGroupLine,
  computeConversion,
  computeResumeComparison,
  formatPercent,
  SMALL_SAMPLE_THRESHOLD,
  type ConversionRow,
} from "@/lib/analytics";
import { computeFunnel, computeOutcomes } from "@/lib/funnel";
import type { SkillGapAnalysis } from "@/lib/actions/skill-gap";
import { PageHero } from "@/components/layout/page-hero";
import { applicationCities, cityGroup, NO_CITY } from "@/lib/application-city";
import { industryLabel, NO_INDUSTRY } from "@/lib/company-industry";

export default async function InsightsPage() {
  const user = await requireUser();

  const [applications, resumeVersions, skillGaps, resumeComparisonSummary] = await Promise.all([
    db.application.findMany({
      where: { userId: user.id },
      include: {
        resumeVersion: { select: { name: true } },
        position: { select: { track: true, location: true } },
        company: { select: { name: true, industry: true, sector: true } },
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
    db.resumeComparisonSummary.findUnique({
      where: { userId: user.id },
      select: { narrative: true },
    }),
  ]);
  const defaultResumeVersionId = resumeVersions.find((r) => r.isDefault)?.id ?? null;
  const skillGapResults = Object.fromEntries(
    skillGaps.map((s) => [s.resumeVersionId, s.result as SkillGapAnalysis])
  );

  const { bySource, byTrack, byIndustry, byCity } = computeConversion(
    applications.map((app) => {
      const industry = industryLabel(app.company);
      const city = cityGroup(applicationCities({ city: app.city, location: app.position?.location, title: app.title, companyName: app.company.name }));
      return { ...app, industry: industry === NO_INDUSTRY ? null : industry, city: city === NO_CITY ? null : city };
    })
  );
  const noIndustry = applications.filter((app) => industryLabel(app.company) === NO_INDUSTRY).length;
  const resumeComparison = computeResumeComparison(applications);
  const { levels, total } = computeFunnel(applications);
  const outcomes = computeOutcomes(applications);
  // The funnel only needs applications to exist at all — unlike the two
  // grouped cards below, it doesn't depend on source/track being filled in,
  // so it must not be hidden by the same "no grouped data yet" check (an
  // account with plenty of ungrouped applications would otherwise never
  // see it).
  const hasApplications = applications.length > 0;
  const hasGrouped = bySource.length > 0 || byTrack.length > 0 || byIndustry.length > 0 || byCity.length > 0;

  return (
    <div className="space-y-6">
      <PageHero title="投递转化率" icon={TrendingUp} description="看看哪个渠道、哪版简历、哪个方向更容易拿到面试，好决定精力往哪放" />

      {!hasApplications ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <TrendingUp className="size-8 text-muted-foreground/50" />
          <span className="text-sm">
            还没有足够的数据。加几条投递记录，这里就会有分析
          </span>
        </div>
      ) : (
        <>
          <FunnelCard levels={levels} total={total} outcomes={outcomes} />
          <ResumeComparisonCard
            rows={resumeComparison}
            initialNarrative={resumeComparisonSummary?.narrative ?? null}
          />
          {hasGrouped ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <ConversionCard title="按行业" rows={byIndustry} emptyHint="公司还没有行业；在「投递记录」里点「让 AI 补全」就会有" note={noIndustry > 0 ? `${noIndustry} 条投递的公司还没有行业，没算进来` : undefined} />
              <ConversionCard title="按城市" rows={byCity} emptyHint="投递记录里还没有能认出的城市" />
              <ConversionCard title="按渠道" rows={bySource} emptyHint="投递记录里还没填渠道" />
              <ConversionCard title="按岗位方向" rows={byTrack} emptyHint="从候选池标记已投的记录才带方向" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              投递记录里填了渠道、行业、城市，这里还会有更细的对比
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

function ConversionCard({
  title,
  rows,
  emptyHint,
  note,
}: {
  title: string;
  rows: ConversionRow[];
  emptyHint: string;
  note?: string;
}) {
  const best = bestGroupLine(rows);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {best && <p className="text-xs text-muted-foreground">{best}</p>}
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
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>
                <span className="text-muted-foreground">笔试/测评 </span>
                <span className="font-medium">{formatPercent(r.assessedRate)}</span>
                <span className="text-xs text-muted-foreground"> ({r.assessed})</span>
              </span>
              <span>
                <span className="text-muted-foreground">面试 </span>
                <span className="font-medium">{formatPercent(r.interviewedRate)}</span>
                <span className="text-xs text-muted-foreground"> ({r.interviewed})</span>
              </span>
              <span>
                <span className="text-muted-foreground">Offer </span>
                <span className="font-medium">{formatPercent(r.offerRate)}</span>
                <span className="text-xs text-muted-foreground"> ({r.offers})</span>
              </span>
            </div>
          </div>
        ))}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
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
