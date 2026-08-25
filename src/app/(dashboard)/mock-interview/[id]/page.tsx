import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { MockInterviewChat } from "@/components/mock-interview/chat";
import type { InterviewFeedback } from "@/lib/validation";

export default async function MockInterviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const session = await db.interviewSession.findFirst({
    where: { id, userId: user.id },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      resumeVersion: true,
      position: { include: { company: true } },
    },
  });
  if (!session) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {session.position
            ? `${session.position.company.name} · ${session.position.title}`
            : session.targetRole || "模拟面试"}
        </h1>
        <p className="text-sm text-muted-foreground">
          简历版本：{session.resumeVersion.name}
        </p>
      </div>

      <MockInterviewChat
        sessionId={session.id}
        initialMessages={session.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          deliveryNote: m.deliveryNote,
        }))}
        initialStatus={session.status}
        initialFeedback={session.feedback as InterviewFeedback | null}
      />
    </div>
  );
}
