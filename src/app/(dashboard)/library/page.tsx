import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { LibraryView, type LibraryFile } from "@/components/library/library-view";
import { parseApplicationProfile } from "@/lib/application-profile";
import { PageHero } from "@/components/layout/page-hero";
import { FolderOpen } from "lucide-react";

export default async function LibraryPage() {
  const user = await requireUser();

  const [attachments, resumes] = await Promise.all([
    db.attachment.findMany({
      where: { userId: user.id },
      include: {
        application: { include: { company: true } },
        // Files attached to a stage carry their application through the stage.
        stageHistory: { include: { application: { include: { company: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.resumeVersion.findMany({
      where: { userId: user.id, fileUrl: { not: null } },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const files: LibraryFile[] = attachments.map((a) => {
    const app = a.application ?? a.stageHistory?.application ?? null;
    return {
      id: a.id,
      name: a.name,
      url: a.url,
      category: a.category,
      createdAt: a.createdAt.toISOString(),
      application: app
        ? { id: app.id, companyName: app.company.name, title: app.title }
        : null,
    };
  });
  const pinnedAttachments = parseApplicationProfile(user.applicationProfile).pinnedAttachments ?? {};

  return (
    <div className="space-y-6">
      <PageHero title="资料库" icon={FolderOpen} description="证书、作品集、笔试真题、面试资料集中放一处，投递记录里传过的附件也会汇总到这里" />
      <LibraryView files={files} resumeVersions={resumes} initialPinned={pinnedAttachments} />
    </div>
  );
}
