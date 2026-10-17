import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseApplicationProfile } from "@/lib/application-profile";
import { tailoredResumeSchema } from "@/lib/tailored-resume";
import { TailoredResumeEditor } from "@/components/resumes/tailored-resume-editor";
import { PageHero } from "@/components/layout/page-hero";
import { FileText } from "lucide-react";

export default async function TailoredResumePage({
  searchParams,
}: {
  searchParams: Promise<{ positionId?: string; resumeVersionId?: string }>;
}) {
  const user = await requireUser();
  const { positionId, resumeVersionId: requested } = await searchParams;
  if (!positionId) notFound();
  const [position, resumes] = await Promise.all([
    db.position.findFirst({ where: { id: positionId, userId: user.id }, include: { company: true } }),
    db.resumeVersion.findMany({ where: { userId: user.id }, select: { id: true, name: true, isDefault: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] }),
  ]);
  // Opened from the pool without a resume: start from the default one.
  const resume = resumes.find((r) => r.id === requested) ?? resumes[0];
  if (!position) notFound();
  if (!resume) {
    return (
      <PageHero title="定制简历" icon={FileText} description={<>还没有简历。先到 <Link href="/resumes" className="underline">简历版本</Link> 上传一份，定制简历会基于它改写。</>} />
    );
  }
  const resumeVersionId = resume.id;
  const tailoring = await db.resumeTailoring.findFirst({ where: { positionId, resumeVersionId, userId: user.id }, select: { result: true } });
  const stored = (tailoring?.result as { document?: unknown; documentBody?: string | null } | null) ?? null;
  const document = stored?.document ? tailoredResumeSchema.safeParse(stored.document) : null;
  const profile = parseApplicationProfile(user.applicationProfile);

  return (
    <div className="space-y-4">
      <PageHero
        title="定制简历"
        icon={FileText}
        description={<>{position.company.name} · {position.title}　基于「{resume.name}」和网申资料整理，只调整已有事实的取舍和表述。可以直接在预览里改字，改动会自动保存。</>}
      >
        {resumes.length > 1 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">基于哪份简历：</span>
            {resumes.map((r) => (
              <Link
                key={r.id}
                href={`/resumes/tailored?positionId=${encodeURIComponent(position.id)}&resumeVersionId=${encodeURIComponent(r.id)}`}
                className={`rounded-full border px-2.5 py-0.5 ${r.id === resume.id ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {r.name}
              </Link>
            ))}
          </div>
        )}
      </PageHero>
      <TailoredResumeEditor
        key={resume.id}
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
