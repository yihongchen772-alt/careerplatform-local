import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { AddPositionDialog } from "@/components/pool/add-position-dialog";
import { PoolTable } from "@/components/pool/pool-table";
import { computeConversion, type ConversionRow } from "@/lib/analytics";
import type { InterviewPrep, GroupInterviewPrep } from "@/lib/validation";

export default async function PoolPage({ searchParams }: { searchParams: Promise<{ position?: string; prep?: string; from?: string }> }) {
  const { position: selected, prep, from } = await searchParams;
  // Opened from a 投递's 「岗位 JD / 面试攻略」: a way straight back to it.
  const backTo = from && /^[A-Za-z0-9_-]{1,100}$/.test(from) ? from : null;
  const user = await requireUser();

  const [positions, resumeVersions, applications] = await Promise.all([
    db.position.findMany({
      where: { userId: user.id, ...(selected ? { id: selected } : {}) },
      include: {
        company: true,
        interviewPrep: true,
        groupInterviewPrep: true,
        coverLetter: { select: { content: true } },
        // A position can have one PositionMatch per resume version it's been
        // checked against — only the best score across those matters for a
        // quick-scan list column, so just the two fields needed to pick it.
        positionMatches: { select: { matchScore: true, recommendation: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
    }),
    // Only needed for the "historical success rate by track" ingredient of
    // the Opportunity Score below — nothing else on this page reads it.
    db.application.findMany({
      where: { userId: user.id },
      include: {
        resumeVersion: { select: { name: true } },
        position: { select: { track: true } },
        stageHistory: { select: { stage: true } },
      },
    }),
  ]);

  const defaultResumeVersionId =
    resumeVersions.find((r) => r.isDefault)?.id ?? null;
  const historyByTrack: Record<string, ConversionRow> = Object.fromEntries(
    computeConversion(applications).byTrack.map((row) => [row.key, row])
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">候选岗位池</h1>
        <AddPositionDialog />
      </div>

      {selected && <div className="flex flex-wrap gap-4 text-sm">{backTo && <a href={`/applications/${backTo}#interview`} className="text-primary underline">← 回到这条投递</a>}<a href="/pool" className="text-primary underline">返回全部候选岗位</a></div>}
      <Card>
        <CardContent className="pt-6">
          <PoolTable
            positions={positions.map((p) => {
              const { positionMatches, coverLetter, ...rest } = p;
              const bestMatch = positionMatches.reduce<
                { score: number; recommendation: string } | null
              >(
                (best, m) =>
                  !best || m.matchScore > best.score
                    ? { score: m.matchScore, recommendation: m.recommendation }
                    : best,
                null
              );
              return {
                ...rest,
                deadline: p.deadline?.toISOString() ?? null,
                interviewPrep: p.interviewPrep
                  ? (p.interviewPrep.content as InterviewPrep)
                  : null,
                groupInterviewPrep: p.groupInterviewPrep
                  ? (p.groupInterviewPrep.content as GroupInterviewPrep)
                  : null,
                bestMatch,
                coverLetter: coverLetter?.content ?? null,
              };
            })}
            resumeVersions={resumeVersions}
            defaultResumeVersionId={defaultResumeVersionId}
            historyByTrack={historyByTrack}
            openPrepFor={selected && prep === "1" ? selected : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
