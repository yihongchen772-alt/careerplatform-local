import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AddResumeDialog } from "@/components/resumes/add-resume-dialog";
import { ResumeList } from "@/components/resumes/resume-list";
import type { ResumeCheck } from "@/lib/validation";
import { PageHero } from "@/components/layout/page-hero";
import { FileText, Wand2 } from "lucide-react";
import Link from "next/link";
import type { ApplicationStage } from "@prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { TailoringList, type TailoringRow } from "@/components/resumes/tailoring-list";
import { parseDraft } from "@/lib/resume-doc";

const INTERVIEW_ROUNDS: ApplicationStage[] = ["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW", "OFFER", "ACCEPTED"];

export default async function ResumesPage() {
  const user = await requireUser();

  const [found, applications, tailorings] = await Promise.all([
    db.resumeVersion.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, omit: { structured: true } }),
    db.application.findMany({ where: { userId: user.id, resumeVersionId: { not: null } }, select: { resumeVersionId: true, stageHistory: { select: { stage: true } } } }),
    db.resumeTailoring.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: { id: true, draft: true, updatedAt: true, savedVersionId: true, resumeVersion: { select: { name: true } }, savedVersion: { select: { name: true } } },
    }),
  ]);
  // 按 JD 定制 working copies (rows from the match dialog alone have no draft).
  const tailoringRows: TailoringRow[] = tailorings.flatMap((row) => {
    const draft = parseDraft(row.draft);
    if (!draft) return [];
    return [{
      id: row.id,
      target: [draft.target.company, draft.target.title].filter(Boolean).join(" · ") || "按 JD 定制",
      baseName: row.resumeVersion.name,
      savedName: row.savedVersion?.name ?? null,
      generated: !!draft.doc,
      updatedAt: row.updatedAt.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    }];
  });
  const tailoringOfVersion = new Map(tailorings.filter((row) => row.savedVersionId).map((row) => [row.savedVersionId!, row.id]));
  // How each version has done: 投递 sent with it, and how many of those reached a 面试 round.
  const usage = new Map<string, { applied: number; interviewed: number }>();
  for (const app of applications) {
    const row = usage.get(app.resumeVersionId!) ?? { applied: 0, interviewed: 0 };
    row.applied += 1;
    if (app.stageHistory.some((step) => INTERVIEW_ROUNDS.includes(step.stage))) row.interviewed += 1;
    usage.set(app.resumeVersionId!, row);
  }
  // The default first, then the most used: the versions in play on top.
  const resumes = [...found].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (usage.get(b.id)?.applied ?? 0) - (usage.get(a.id)?.applied ?? 0));

  return (
    <div className="space-y-6">
      <PageHero
        title="简历版本"
        icon={FileText}
        description="不同方向用不同版本的简历，网申和小欧会按岗位选用。也可以按某个岗位的 JD，在现有简历上微调出一份。"
        actions={<><Link href="/resumes/tailor" className={buttonVariants({ size: "sm" })}><Wand2 />按 JD 定制一份</Link><AddResumeDialog /></>}
      />

      <ResumeList
        resumes={resumes.map((r) => ({
          ...r,
          checkResult: (r.checkResult as ResumeCheck | null) ?? null,
          checkedAt: r.checkedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          applied: usage.get(r.id)?.applied ?? 0,
          interviewed: usage.get(r.id)?.interviewed ?? 0,
          tailoringId: tailoringOfVersion.get(r.id) ?? null,
        }))}
      />

      <TailoringList rows={tailoringRows} />
    </div>
  );
}
