import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { LibraryView, type LibraryFile } from "@/components/library/library-view";

export default async function LibraryPage() {
  const user = await requireUser();

  const attachments = await db.attachment.findMany({
    where: { userId: user.id },
    include: {
      application: { include: { company: true } },
      // Files attached to a stage carry their application through the stage.
      stageHistory: { include: { application: { include: { company: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">资料库</h1>
        <p className="text-sm text-muted-foreground">
          证书、作品集、笔试真题、面试资料集中放一处，投递记录里传过的附件也会汇总到这里
        </p>
      </div>
      <LibraryView files={files} />
    </div>
  );
}
