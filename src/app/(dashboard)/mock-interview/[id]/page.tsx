import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { MockInterviewChat } from "@/components/mock-interview/chat";
import { BackLink } from "@/components/ui/back-link";
import type { InterviewFeedback } from "@/lib/validation";
import { PageHero } from "@/components/layout/page-hero";
import { MessageSquare } from "lucide-react";

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
      <PageHero
        title={session.position ? `${session.position.company.name} · ${session.position.title}` : session.targetRole || "模拟面试"}
        description={`简历版本：${session.resumeVersion.name}`}
        icon={MessageSquare}
        back={<BackLink href="/mock-interview" label="返回模拟面试" />}
      />

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
        includeCoding={session.includeCoding}
      />
    </div>
  );
}
