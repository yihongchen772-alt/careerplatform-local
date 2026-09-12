import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { loadResumeDrill } from "@/lib/resume-drill";
import { ResumeDrillWorkbench } from "@/components/resume-drill/workbench";

export default async function ResumeDrillPage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string; position?: string }>;
}) {
  const user = await requireUser();
  const { resume, position } = await searchParams;

  const [resumeVersions, positions, dbUser] = await Promise.all([
    db.resumeVersion.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
    db.position.findMany({
      where: { userId: user.id },
      include: { company: true },
      orderBy: { createdAt: "desc" },
    }),
    db.user.findUnique({ where: { id: user.id }, select: { defaultAiProvider: true } }),
  ]);

  // The URL pins which resume is being drilled so a reload after answering
  // lands back on the same tree instead of the default resume's.
  const selectedResumeId =
    resumeVersions.find((r) => r.id === resume)?.id ?? resumeVersions[0]?.id ?? null;
  const drill = selectedResumeId ? await loadResumeDrill(user.id, selectedResumeId) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">简历深挖</h1>
        <p className="text-sm text-muted-foreground">
          面试官最爱盯着简历上的项目往深了问。AI 先把每段经历的三层追问列出来，你逐层作答，它按要点打分、告诉你下一句会被问什么
        </p>
      </div>

      <ResumeDrillWorkbench
        resumeVersions={resumeVersions}
        positions={positions.map((p) => ({ id: p.id, label: `${p.company.name} · ${p.title}` }))}
        selectedResumeId={selectedResumeId}
        initialDrill={drill}
        initialPositionId={positions.find((p) => p.id === position)?.id ?? null}
        hasOwnKey={!!dbUser?.defaultAiProvider}
      />
    </div>
  );
}
