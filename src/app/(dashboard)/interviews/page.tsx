import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import {
  InterviewNotes,
  type InterviewNote,
} from "@/components/interviews/interview-notes";

export default async function InterviewsPage() {
  const user = await requireUser();

  const histories = await db.stageHistory.findMany({
    where: {
      application: { userId: user.id },
      // A stage row only belongs in the library if it carries something worth
      // re-reading — a bare "moved to 一面" entry would just be noise.
      OR: [
        { note: { not: null } },
        { interviewer: { not: null } },
        { interviewFormat: { not: null } },
      ],
    },
    include: { application: { include: { company: true } } },
    orderBy: { enteredAt: "desc" },
  });

  const notes: InterviewNote[] = histories.map((h) => ({
    id: h.id,
    stage: h.stage,
    enteredAt: h.enteredAt.toISOString(),
    note: h.note,
    interviewFormat: h.interviewFormat,
    interviewer: h.interviewer,
    applicationId: h.applicationId,
    companyName: h.application.company.name,
    title: h.application.title,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">面经库</h1>
        <p className="text-sm text-muted-foreground">
          汇总所有投递里写过的面试复盘，面试前可以按公司或阶段翻一遍
        </p>
      </div>
      <InterviewNotes notes={notes} />
    </div>
  );
}
