import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AddApplicationDialog } from "@/components/applications/add-application-dialog";
import { ApplicationsView } from "@/components/applications/applications-view";

export default async function ApplicationsPage() {
  const user = await requireUser();

  const [applications, resumeVersions] = await Promise.all([
    db.application.findMany({
      where: { userId: user.id },
      include: {
        company: true,
        // Only the entry matching the application's current stage is still
        // relevant to "what's next" — earlier stages' deadlines are history.
        // Deliberately NOT `orderBy: enteredAt desc, take: 1`: the very
        // first history row (APPLIED) stores enteredAt as a date-only value
        // parsed at UTC midnight, while every later row stores the real
        // instant of the update — for a same-day application from UTC+8,
        // that date-only midnight can sort *after* a same-day real
        // timestamp, so "latest by enteredAt" can silently pick the wrong
        // row. Matching on stage directly sidesteps the comparison.
        stageHistory: {
          select: { stage: true, nextDeadline: true, nextDeadlineEnd: true },
        },
      },
      orderBy: { appliedDate: "desc" },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const defaultResumeVersionId =
    resumeVersions.find((r) => r.isDefault)?.id ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">投递记录</h1>
        <AddApplicationDialog
          resumeVersions={resumeVersions}
          defaultResumeVersionId={defaultResumeVersionId}
        />
      </div>

      <ApplicationsView
        applications={applications.map((a) => {
          const currentEntry = a.stageHistory.find((h) => h.stage === a.currentStage);
          return {
            ...a,
            appliedDate: a.appliedDate.toISOString(),
            currentStageDate: a.currentStageDate.toISOString(),
            nextDeadline: currentEntry?.nextDeadline?.toISOString() ?? null,
            nextDeadlineEnd: currentEntry?.nextDeadlineEnd?.toISOString() ?? null,
          };
        })}
      />
    </div>
  );
}
