import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { MockInterviewStartForm } from "@/components/mock-interview/start-form";
import { MockInterviewSessionList } from "@/components/mock-interview/session-list";

export default async function MockInterviewPage() {
  const user = await requireUser();

  const [resumeVersions, positions, standaloneApplications, sessions, dbUser] = await Promise.all([
    db.resumeVersion.findMany({
      where: { userId: user.id, checkResult: { not: Prisma.DbNull } },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
    db.position.findMany({
      where: { userId: user.id },
      include: { company: true },
      orderBy: { createdAt: "desc" },
    }),
    // Applications added directly (not via the candidate pool) have no
    // Position row of their own, so without this they'd never be pickable
    // here at all. Applications that DO have a positionId are already
    // covered by the positions list above — no need to list them twice.
    db.application.findMany({
      where: { userId: user.id, positionId: null },
      include: { company: true },
      orderBy: { createdAt: "desc" },
    }),
    db.interviewSession.findMany({
      where: { userId: user.id },
      include: { resumeVersion: true, position: { include: { company: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.user.findUnique({ where: { id: user.id }, select: { defaultAiProvider: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">AI 模拟面试</h1>
        <p className="text-sm text-muted-foreground">
          选一份简历，AI 一问你一答，打字回答，大概 10-15 分钟一场
        </p>
      </div>

      <MockInterviewStartForm
        resumeVersions={resumeVersions}
        positions={positions.map((p) => ({
          id: p.id,
          label: `${p.company.name} · ${p.title}`,
        }))}
        applications={standaloneApplications.map((a) => ({
          id: a.id,
          label: `${a.company.name} · ${a.title}`,
        }))}
        hasOwnKey={!!dbUser?.defaultAiProvider}
      />

      {sessions.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <MockInterviewSessionList
              sessions={sessions.map((s) => ({
                id: s.id,
                label: s.position
                  ? `${s.position.company.name} · ${s.position.title}`
                  : s.targetRole || "通用面试",
                resumeName: s.resumeVersion.name,
                status: s.status,
              }))}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
