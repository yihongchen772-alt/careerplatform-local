import Link from "next/link";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MockInterviewStartForm } from "@/components/mock-interview/start-form";
import { MessageSquare } from "lucide-react";

export default async function MockInterviewPage() {
  const user = await requireUser();

  const [resumeVersions, positions, sessions, dbUser] = await Promise.all([
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
        <h1 className="text-2xl font-semibold">AI 模拟面试</h1>
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
        hasOwnKey={!!dbUser?.defaultAiProvider}
      />

      {sessions.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium">历史记录</p>
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/mock-interview/${s.id}`}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm hover:bg-muted"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {s.position
                      ? `${s.position.company.name} · ${s.position.title}`
                      : s.targetRole || "通用面试"}
                    {" · "}
                    {s.resumeVersion.name}
                  </span>
                </div>
                <Badge variant={s.status === "ENDED" ? "secondary" : "outline"}>
                  {s.status === "ENDED" ? "已结束" : "进行中"}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
