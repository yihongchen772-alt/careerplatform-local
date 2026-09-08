import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { AddPositionDialog } from "@/components/pool/add-position-dialog";
import { PoolTable } from "@/components/pool/pool-table";
import type { InterviewPrep, GroupInterviewPrep } from "@/lib/validation";

export default async function PoolPage() {
  const user = await requireUser();

  const [positions, resumeVersions] = await Promise.all([
    db.position.findMany({
      where: { userId: user.id },
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
  ]);

  const defaultResumeVersionId =
    resumeVersions.find((r) => r.isDefault)?.id ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">候选岗位池</h1>
        <AddPositionDialog />
      </div>

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
          />
        </CardContent>
      </Card>
    </div>
  );
}
