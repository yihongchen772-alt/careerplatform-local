import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AddResumeDialog } from "@/components/resumes/add-resume-dialog";
import { ResumeList } from "@/components/resumes/resume-list";
import type { ResumeCheck } from "@/lib/validation";

export default async function ResumesPage() {
  const user = await requireUser();

  const resumes = await db.resumeVersion.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">简历版本</h1>
        <AddResumeDialog />
      </div>

      <ResumeList
        resumes={resumes.map((r) => ({
          ...r,
          checkResult: (r.checkResult as ResumeCheck | null) ?? null,
          checkedAt: r.checkedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
