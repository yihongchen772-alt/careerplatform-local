import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { ImportSheetDialog } from "@/components/leads/import-sheet-dialog";
import { LeadsTable } from "@/components/leads/leads-table";
import { RadarEventsCard } from "@/components/leads/radar-events-card";
import { daysAgo } from "@/lib/dates";
import { PageHero } from "@/components/layout/page-hero";
import { Database } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PostingsPanel } from "@/components/leads/postings-panel";
import { DiscoverJobsPanel } from "@/components/leads/discover-jobs-panel";
import { ListPositionKeeper } from "@/components/leads/list-position-keeper";
import { Suspense } from "react";
import { readPostingFilters } from "@/lib/campus-postings-query";
import { parseApplicationProfile } from "@/lib/application-profile";

// How far back a radar event is still worth surfacing here — this page is
// for "what's worth looking at right now", not a permanent radar log (that
// stays on /companies, where radarLastChangedAt is always visible per row).
const RADAR_EVENT_WINDOW_DAYS = 14;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const [sources, ownLeads, batchResumes, profileRow] = await Promise.all([
    db.postingSource.count({ where: { userId: user.id } }),
    db.jobLead.count({ where: { userId: user.id } }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
    db.user.findUnique({ where: { id: user.id }, select: { applicationProfile: true } }),
  ]);
  const profileVariants = parseApplicationProfile(profileRow?.applicationProfile).variants.map((v) => ({
    id: v.id,
    name: v.name,
    resumeVersionId: v.resumeVersionId ?? null,
  }));
  // A subscribed 校招信息表 is the main list once there is one; 我整理的 is what was imported or captured by hand.
  // With neither, the place to paste the link comes first, not an empty list hiding it behind a tab.
  const view = params.view === "discover" ? "discover" : params.view === "mine" || params.view === "postings" ? params.view : sources > 0 || ownLeads === 0 ? "postings" : "mine";
  const tabs = (
    <div role="tablist" aria-label="秋招信息库" className="inline-flex flex-wrap items-center gap-1 rounded-full bg-foreground/[0.05] p-1 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] dark:bg-white/[0.06]">
      {([["postings", "订阅的招聘信息"], ["discover", "全网实时搜岗"], ["mine", "我整理的"]] as const).map(([id, label]) => (
        <Link
          key={id}
          role="tab"
          aria-selected={view === id}
          href={`/leads?view=${id}`}
          className={cn(
            "rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200 ease-(--ease-apple)",
            view === id
              ? "bg-card text-foreground shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] dark:ring-white/[0.08]"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  );
  if (view === "discover") {
    return (
      <div className="space-y-6">
        <PageHero title="秋招信息库" icon={Database} description="实时检索企业官网直招、订阅信息表与全网招聘公告，按你的求职意向排序，一键批量打开预填" />
        {tabs}
        <Card>
          <CardContent className="pt-6">
            <DiscoverJobsPanel
              defaultTrack={user.targetTrack ?? ""}
              defaultCities={user.preferredCities ?? ""}
              resumeVersions={batchResumes}
              profileVariants={profileVariants}
            />
          </CardContent>
        </Card>
      </div>
    );
  }
  if (view === "postings") {
    return (
      <div className="space-y-6">
        <PageHero title="秋招信息库" icon={Database} description="内置名企每日直招池与飞书校招表自动同步；筛完点「投递」直接网申，想投的加入候选岗位池" />
        {tabs}
        <Suspense><ListPositionKeeper /></Suspense>
        <Card><CardContent className="pt-6"><PostingsPanel userId={user.id} filters={readPostingFilters(params)} profileVariants={profileVariants} /></CardContent></Card>
      </div>
    );
  }

  const [leads, resumeVersions, radarEvents] = await Promise.all([
    db.jobLead.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
    }),
    db.radarJobEvent.findMany({
      where: { createdAt: { gte: daysAgo(RADAR_EVENT_WINDOW_DAYS) } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { company: { select: { id: true, name: true, careerUrl: true } } },
    }),
  ]);

  const defaultResumeVersionId = resumeVersions.find((r) => r.isDefault)?.id ?? null;

  // Only NEW events ever get an import button, so only those need the
  // "is this already in the info library" dedupe check.
  const newEvents = radarEvents.filter((e) => e.type === "NEW");
  const existingLeadsForNewEvents =
    newEvents.length > 0
      ? await db.jobLead.findMany({
          where: {
            userId: user.id,
            OR: newEvents.map((e) => ({ companyName: e.company.name, title: e.title })),
          },
          select: { companyName: true, title: true },
        })
      : [];
  const importedKeys = new Set(existingLeadsForNewEvents.map((l) => `${l.companyName} ${l.title}`));

  return (
    <div className="space-y-6">
      <PageHero
        title="秋招信息库"
        icon={Database}
        description="群里那种大而全的秋招信息表放这里，筛完再把想投的挑进候选岗位池"
        actions={<ImportSheetDialog resumeVersions={resumeVersions.map((r) => ({ id: r.id, name: r.name }))} defaultResumeVersionId={defaultResumeVersionId} />}
      />

      {tabs}

      <RadarEventsCard
        events={radarEvents.map((e) => ({
          id: e.id,
          companyId: e.companyId,
          companyName: e.company.name,
          careerUrl: e.company.careerUrl,
          title: e.title,
          type: e.type,
          detail: e.detail,
          createdAt: e.createdAt.toISOString(),
          alreadyImported: e.type === "NEW" && importedKeys.has(`${e.company.name} ${e.title}`),
        }))}
      />

      <Card>
        <CardContent className="pt-6">
          <LeadsTable
            leads={leads.map((l) => ({
              id: l.id,
              companyName: l.companyName,
              title: l.title,
              track: l.track,
              department: l.department,
              location: l.location,
              salaryMin: l.salaryMin,
              salaryMax: l.salaryMax,
              deadline: l.deadline?.toISOString() ?? null,
              source: l.source,
              jdUrl: l.jdUrl,
              note: l.note,
              fitScore: l.fitScore,
              fitReason: l.fitReason,
              batch: l.batch,
              promoted: !!l.promotedPositionId,
            }))}
            resumeVersions={resumeVersions.map((r) => ({ id: r.id, name: r.name }))}
            defaultResumeVersionId={defaultResumeVersionId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
