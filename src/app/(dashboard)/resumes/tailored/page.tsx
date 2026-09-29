import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseApplicationProfile } from "@/lib/application-profile";
import { tailoredResumeSchema } from "@/lib/tailored-resume";
import { TailoredResumeEditor } from "@/components/resumes/tailored-resume-editor";

export default async function TailoredResumePage({
  searchParams,
}: {
  searchParams: Promise<{ positionId?: string; resumeVersionId?: string }>;
}) {
  const user = await requireUser();
  const { positionId, resumeVersionId } = await searchParams;
  if (!positionId || !resumeVersionId) notFound();
  const [position, resume, tailoring] = await Promise.all([
    db.position.findFirst({ where: { id: positionId, userId: user.id }, include: { company: true } }),
    db.resumeVersion.findFirst({ where: { id: resumeVersionId, userId: user.id }, select: { id: true, name: true } }),
    db.resumeTailoring.findFirst({ where: { positionId, resumeVersionId, userId: user.id }, select: { result: true } }),
  ]);
  if (!position || !resume) notFound();
  const stored = (tailoring?.result as { document?: unknown; documentBody?: string | null } | null) ?? null;
  const document = stored?.document ? tailoredResumeSchema.safeParse(stored.document) : null;
  const profile = parseApplicationProfile(user.applicationProfile);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">定制简历</h1>
        <p className="text-sm text-muted-foreground">
          {position.company.name} · {position.title}　基于「{resume.name}」和网申资料整理，只调整已有事实的取舍和表述。可以直接在预览里改字，改完保存或导出。
        </p>
      </div>
      <TailoredResumeEditor
        positionId={position.id}
        resumeVersionId={resume.id}
        fileBase={`${user.name || "简历"}-${position.company.name}-${position.title}`}
        initialDocument={document?.success ? document.data : null}
        initialBody={stored?.documentBody ?? null}
        contact={{ name: user.name ?? "", phone: user.phone ?? "", email: user.contactEmail ?? "", city: profile.extras.currentCity ?? "" }}
        education={profile.education}
      />
    </div>
  );
}
