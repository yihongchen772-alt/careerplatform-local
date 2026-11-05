import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Wand2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseDraft } from "@/lib/resume-doc";
import { PageHero } from "@/components/layout/page-hero";
import { BackLink } from "@/components/ui/back-link";
import { TailorStart, type TailorPositionOption } from "@/components/resumes/tailor-start";
import { TailorWorkbench } from "@/components/resumes/tailor-workbench";

const STATUS_LABEL: Record<string, string> = { EVALUATING: "候选", PLANNED: "准备投", APPLIED: "已投递", DROPPED: "已放弃" };

export default async function TailorResumePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; positionId?: string; resumeVersionId?: string }>;
}) {
  const user = await requireUser();
  const { id, positionId, resumeVersionId } = await searchParams;
  const resumes = await db.resumeVersion.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, isDefault: true, fileUrl: true, structuredAt: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  const resumeOptions = resumes.map((r) => ({ id: r.id, name: r.name, isDefault: r.isDefault, hasBase: !!r.structuredAt, hasFile: !!r.fileUrl }));
  const back = <BackLink href="/resumes" label="简历版本" />;

  if (id) {
    const row = await db.resumeTailoring.findFirst({
      where: { id, userId: user.id },
      include: {
        resumeVersion: { select: { id: true, name: true, fileUrl: true } },
        savedVersion: { select: { id: true, name: true } },
        position: { include: { company: true } },
      },
    });
    if (!row) notFound();
    const draft = parseDraft(row.draft);
    const target = draft?.target ?? {
      company: row.position?.company.name ?? "",
      title: row.position?.title ?? "",
      jdText: row.position?.jdText ?? "",
      url: row.position?.jdUrl ?? "",
    };
    const heading = [target.company, target.title].filter(Boolean).join(" · ") || "按 JD 定制";
    if (!draft?.doc) {
      return (
        <div className="space-y-4">
          <PageHero back={back} title="定制简历" icon={Wand2} description={<>{heading}　选一份简历当底稿，AI 只改少量字句，版式不变。</>} />
          <TailorStart tailoringId={row.id} positions={[]} resumes={resumeOptions} initialResumeId={row.resumeVersionId} initialTarget={target} initialMode={draft?.mode ?? "text"} />
        </div>
      );
    }
    return (
      <TailorWorkbench
        key={`${row.id}:${draft.generatedAt}`}
        id={row.id}
        back={back}
        draft={{ ...draft, doc: draft.doc }}
        baseResume={row.resumeVersion}
        savedVersion={row.savedVersion}
        resumes={resumeOptions}
      />
    );
  }

  // From a 候选岗位: straight back into the 定制 already made for it.
  if (positionId) {
    const resumeId = resumes.find((r) => r.id === resumeVersionId)?.id ?? resumes[0]?.id;
    const rows = resumeId
      ? await db.resumeTailoring.findMany({ where: { userId: user.id, positionId, resumeVersionId: resumeId }, orderBy: { updatedAt: "desc" }, select: { id: true, draft: true } })
      : [];
    const existing = rows.find((row) => parseDraft(row.draft)?.doc);
    if (existing) redirect(`/resumes/tailor?id=${encodeURIComponent(existing.id)}`);
  }

  const positions = await db.position.findMany({
    where: { userId: user.id },
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
  const options: TailorPositionOption[] = positions
    .map((p) => ({
      id: p.id,
      company: p.company.name,
      title: p.title,
      status: STATUS_LABEL[p.status] ?? "",
      jdLength: p.jdText?.trim().length ?? 0,
    }))
    // Jobs still to apply for first, then the newest.
    .sort((a, b) => Number(b.status === "候选" || b.status === "准备投") - Number(a.status === "候选" || a.status === "准备投"));

  return (
    <div className="space-y-4">
      <PageHero
        back={back}
        title="按 JD 定制简历"
        icon={Wand2}
        description={<>在你现有的简历上做微调：版式、照片、加粗都照原样，只把少量句子换成更贴合这个岗位的说法，每处改动都能单独改回。生成后可以直接在预览里改字，最后存成新的简历版本（PDF）。</>}
      />
      {resumes.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          还没有简历。先到 <Link href="/resumes" className="underline">简历版本</Link> 上传一份，定制会在它上面改。
        </p>
      ) : (
        <TailorStart positions={options} resumes={resumeOptions} initialPositionId={positionId ?? null} initialResumeId={resumes.find((r) => r.id === resumeVersionId)?.id ?? resumes[0].id} initialMode="text" />
      )}
    </div>
  );
}
