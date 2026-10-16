"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, CalendarClock, ListChecks, MessageCircleQuestion, NotebookPen, Printer, RefreshCw, Sparkles, Target, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateInterviewBrief } from "@/lib/actions/interview-brief";
import { relativeText, whenText, type ScheduleItem } from "@/lib/interview-schedule";
import type { InterviewBrief } from "@/lib/interview-brief";
import { MeetingActions } from "@/components/schedule/meeting-actions";
import { useNow } from "@/components/schedule/use-now";

type Note = { id: string; round: string; note: string; date: string; applicationId: string; title: string };

function Section({ icon: Icon, title, children }: { icon: typeof Target; title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid rounded-2xl border border-border/60 bg-card/75 p-4 print:border-black/20 print:bg-white sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-primary print:text-black" />{title}</h2>
      {children}
    </section>
  );
}

/**
 * The 面试速览 page body. Without an AI summary yet it still shows the time,
 * the meeting, the applicant's own notes and saved questions; 「生成速览」
 * adds the rest in about twenty seconds.
 */
export function BriefView({
  applicationId,
  companyName,
  title,
  round,
  next,
  now: serverNow,
  brief: initialBrief,
  updatedAt,
  resumes,
  defaultResumeId,
  notes,
  questions,
  jd,
}: {
  applicationId: string;
  companyName: string;
  title: string;
  round: string;
  next: ScheduleItem | null;
  now: number;
  brief: InterviewBrief | null;
  updatedAt: string | null;
  resumes: { id: string; name: string }[];
  defaultResumeId: string | null;
  notes: Note[];
  questions: { question: string; hint: string }[];
  jd: string;
}) {
  const router = useRouter();
  const now = useNow(serverNow);
  const [brief, setBrief] = useState(initialBrief);
  const [resumeId, setResumeId] = useState(defaultResumeId ?? "");
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const result = await generateInterviewBrief(applicationId, resumeId || null);
      if (!result.ok) return void toast.error(result.message);
      setBrief(result.data);
      toast.success("速览已生成");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="surface-card rounded-xl p-5 print:border-0 print:p-0 sm:p-6">
        <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-primary uppercase print:text-black"><NotebookPen className="size-3.5" />面试速览</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">{companyName} · {round}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{title}</p>
        {next ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm print:bg-transparent print:px-0">
            <span className="inline-flex items-center gap-1.5 font-medium"><CalendarClock className="size-4 text-primary print:text-black" />{whenText(next, now)}</span>
            <span className="text-muted-foreground">{relativeText(next, now)}</span>
            {next.meetingInfo && <span className="min-w-0 basis-full break-all text-xs text-muted-foreground sm:basis-auto">{next.meetingInfo}</span>}
            <span className="print:hidden"><MeetingActions info={next.meetingInfo} exam={next.kind === "exam"} /></span>
          </div>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">还没记面试时间。<Link href={`/applications/${applicationId}?addTime=1#interview`} className="text-primary hover:underline">去添加</Link></p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
          {resumes.length > 1 && (
            <select aria-label="用哪份简历" value={resumeId} onChange={(event) => setResumeId(event.target.value)} className="h-8 rounded-xl border border-input bg-transparent px-2 text-sm dark:bg-input/30">
              {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}
            </select>
          )}
          <Button size="sm" className="gap-1" disabled={busy} onClick={generate}>
            {brief ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
            {busy ? "生成中，约 20 秒…" : brief ? "重新生成" : "生成速览"}
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => window.print()}><Printer className="size-3.5" />打印 / 存 PDF</Button>
          {brief && updatedAt && <span className="text-[11px] text-muted-foreground">生成于 {new Date(updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
        </div>
      </header>

      {brief ? (
        <>
          {brief.summary && <p className="rounded-2xl border border-primary/25 bg-primary/[0.05] px-4 py-3 text-sm font-medium print:border-black/20 print:bg-white">{brief.summary}</p>}
          <div className="grid gap-4 md:grid-cols-2 print:grid-cols-1">
            <Section icon={Target} title="这一轮看重什么">
              <ul className="space-y-2 text-sm">{brief.focus.map((item, index) => <li key={index}><p className="font-medium">{item.point}</p><p className="text-xs text-muted-foreground">{item.why}</p></li>)}</ul>
            </Section>
            <Section icon={UserRound} title="用哪段经历回答">
              <ul className="space-y-2.5 text-sm">{brief.stories.map((item, index) => <li key={index}><p className="font-medium">{item.point}</p><p className="text-xs text-foreground/80">{item.experience}</p><p className="mt-0.5 text-xs text-muted-foreground">怎么讲：{item.howToTell}</p></li>)}</ul>
            </Section>
          </div>
          <Section icon={ListChecks} title="可能被问到">
            <ol className="list-inside list-decimal space-y-1.5 text-sm">{brief.questions.map((item, index) => <li key={index}><span className="font-medium">{item.question}</span><span className="block pl-5 text-xs text-muted-foreground">{item.hint}</span></li>)}</ol>
          </Section>
          <div className="grid gap-4 md:grid-cols-2 print:grid-cols-1">
            <Section icon={MessageCircleQuestion} title="结尾可以反问">
              <ul className="list-inside list-disc space-y-1 text-sm">{brief.askBack.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </Section>
            <Section icon={CalendarClock} title="临场提醒">
              <ul className="list-inside list-disc space-y-1 text-sm">{brief.reminders.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </Section>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/80 bg-card/50 px-5 py-6 text-sm text-muted-foreground print:hidden">
          点「生成速览」：AI 会结合这个岗位的 JD、你的简历和你记过的面经，整理出这一轮最看重的点、用哪段经历回答、可能被问的题和结尾可以反问的问题。下面先放着不用 AI 也有的内容。
        </div>
      )}

      {notes.length > 0 && (
        <Section icon={BookOpen} title={`你记过的 ${companyName} 面经（${notes.length}）`}>
          <ul className="space-y-2 text-sm">
            {notes.map((note) => (
              <li key={note.id} className="rounded-xl bg-muted/40 px-3 py-2 print:bg-transparent print:px-0">
                <p className="text-xs text-muted-foreground">{note.round} · {note.title} · {new Date(note.date).toLocaleDateString("zh-CN")}</p>
                <p className="whitespace-pre-wrap">{note.note}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!brief && questions.length > 0 && (
        <Section icon={ListChecks} title="之前生成的预测题">
          <ol className="list-inside list-decimal space-y-1.5 text-sm">{questions.map((item, index) => <li key={index}><span className="font-medium">{item.question}</span><span className="block pl-5 text-xs text-muted-foreground">{item.hint}</span></li>)}</ol>
        </Section>
      )}

      {jd && (
        <details className="rounded-2xl border border-border/60 bg-card/60 px-4 py-3 text-sm print:hidden">
          <summary className="cursor-pointer font-medium">岗位要求原文</summary>
          <p className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{jd}</p>
        </details>
      )}
    </div>
  );
}
