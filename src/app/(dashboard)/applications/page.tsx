import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AddApplicationDialog } from "@/components/applications/add-application-dialog";
import { ApplicationsView } from "@/components/applications/applications-view";

export default async function ApplicationsPage() {
  const user = await requireUser();

  const [applications, resumeVersions] = await Promise.all([
    db.application.findMany({
      where: { userId: user.id },
      include: { company: true },
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
        <h1 className="text-2xl font-semibold">投递记录</h1>
        <AddApplicationDialog
          resumeVersions={resumeVersions}
          defaultResumeVersionId={defaultResumeVersionId}
        />
      </div>

      <ApplicationsView
        applications={applications.map((a) => ({
          ...a,
          appliedDate: a.appliedDate.toISOString(),
          currentStageDate: a.currentStageDate.toISOString(),
        }))}
      />
    </div>
  );
}
