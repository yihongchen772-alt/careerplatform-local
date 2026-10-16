import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AddResumeDialog } from "@/components/resumes/add-resume-dialog";
import { ResumeList } from "@/components/resumes/resume-list";
import type { ResumeCheck } from "@/lib/validation";
import { PageHero } from "@/components/layout/page-hero";
import { FileText } from "lucide-react";

export default async function ResumesPage() {
  const user = await requireUser();

  const resumes = await db.resumeVersion.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHero title="简历版本" icon={FileText} description="不同方向用不同版本的简历，网申和小欧会按岗位选用" actions={<><AddResumeDialog /></>} />

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
