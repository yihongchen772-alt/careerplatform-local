import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { listRecordings, loadRecording } from "@/lib/interview-recording";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { RecorderWorkbench } from "@/components/interview-recorder/workbench";

export default async function InterviewRecorderPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireUser();
  const { id } = await searchParams;

  const [applications, recordings, selected, dbUser] = await Promise.all([
    db.application.findMany({
      where: { userId: user.id, currentStage: { notIn: ["REJECTED", "ACCEPTED", "DECLINED"] } },
      include: { company: true },
      orderBy: { currentStageDate: "desc" },
    }),
    listRecordings(user.id),
    id ? loadRecording(user.id, id) : Promise.resolve(null),
    db.user.findUnique({ where: { id: user.id }, select: { defaultAiProvider: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">面试录音</h1>
        <p className="text-sm text-muted-foreground">
          真实面试时点一下开始，结束后自动转写、AI 生成复盘——问了什么、你答得怎么样、下次该补什么，一键存进面经库
        </p>
      </div>

      <RecorderWorkbench
        applications={applications.map((a) => ({
          id: a.id,
          label: `${a.company.name} · ${a.title}`,
          stageLabel: STAGE_LABELS[a.currentStage],
        }))}
        recordings={recordings}
        selected={selected}
        hasOwnKey={!!dbUser?.defaultAiProvider}
      />
    </div>
  );
}
