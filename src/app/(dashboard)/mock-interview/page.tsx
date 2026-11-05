import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { MockInterviewStartForm } from "@/components/mock-interview/start-form";
import { MockInterviewSessionList } from "@/components/mock-interview/session-list";
import { PageHero } from "@/components/layout/page-hero";
import Link from "next/link";
import { CalendarClock, MessageSquare } from "lucide-react";
import { loadUpcomingSchedule } from "@/lib/schedule-loader";
import { relativeText } from "@/lib/interview-schedule";
import { currentTimeMs } from "@/lib/dates";

export default async function MockInterviewPage({
  searchParams,
}: {
  searchParams: Promise<{ focusMix?: string; application?: string }>;
}) {
  const user = await requireUser();
  const { focusMix, application: fromApplication } = await searchParams;
  // From a 投递's 「AI 模拟面试」: that job and its resume, already chosen.
  const preset = fromApplication
    ? await db.application.findFirst({ where: { id: fromApplication, userId: user.id }, select: { id: true, positionId: true, resumeVersionId: true, title: true, company: { select: { name: true } } } })
    : null;

  const [resumeVersions, positions, standaloneApplications, sessions, dbUser] = await Promise.all([
    db.resumeVersion.findMany({
      where: { userId: user.id },
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
  // Interviews in the next two weeks, each one click from a mock round for that very job.
  const now = currentTimeMs();
  const coming = (await loadUpcomingSchedule(user.id, new Date(now), 14))
    .filter((item) => item.kind === "interview" && item.applicationId)
    .filter((item, index, list) => list.findIndex((other) => other.applicationId === item.applicationId) === index)
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHero title="AI 模拟面试" icon={MessageSquare} description="选一份简历，AI 一问你一答，打字回答，大概 10-15 分钟一场" />

      {coming.length > 0 && !preset && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="flex items-center gap-1.5 text-sm font-medium"><CalendarClock className="size-4 text-primary" />接下来的面试，先模拟一场</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {coming.map((item) => (
                <Link key={item.applicationId} href={`/mock-interview?application=${item.applicationId}`} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{[item.companyName, item.title].filter(Boolean).join(" · ")}</span>
                    <span className="block text-xs text-muted-foreground">{relativeText(item, now)}</span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-primary">按这个岗位模拟 →</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
        initialFocusMix={focusMix ?? null}
        initialTarget={preset ? (preset.positionId ? `pos:${preset.positionId}` : `app:${preset.id}`) : null}
        initialResumeVersionId={preset?.resumeVersionId ?? null}
        presetLabel={preset ? `${preset.company.name} · ${preset.title}` : null}
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
                createdAt: s.createdAt.toISOString(),
              }))}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
