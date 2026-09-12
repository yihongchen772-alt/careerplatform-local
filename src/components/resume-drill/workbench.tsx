"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Library, Lock, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { answerDrillQuestion, generateResumeDrill, saveDrillAsBank } from "@/lib/actions/resume-drill";
import type { DrillAnswer, DrillProject, DrillQuestion, ResumeDrillDTO } from "@/lib/resume-drill";

type ResumeOption = { id: string; name: string; isDefault: boolean };
type PositionOption = { id: string; label: string };

const NONE = "__none__";

const LEVEL_LABEL: Record<number, string> = {
  1: "第一层 · 讲全貌",
  2: "第二层 · 抠细节",
  3: "第三层 · 压力追问",
};

export function ResumeDrillWorkbench({
  resumeVersions,
  positions,
  selectedResumeId,
  initialDrill,
  initialPositionId,
  hasOwnKey,
}: {
  resumeVersions: ResumeOption[];
  positions: PositionOption[];
  selectedResumeId: string | null;
  initialDrill: ResumeDrillDTO | null;
  /** From ?position= — the pool row's "简历深挖" link preselects its position. */
  initialPositionId?: string | null;
  hasOwnKey: boolean;
}) {
  const router = useRouter();
  const [positionId, setPositionId] = useState(initialPositionId ?? initialDrill?.positionId ?? NONE);
  const [savingBank, setSavingBank] = useState(false);
  const [drill, setDrill] = useState<ResumeDrillDTO | null>(initialDrill);
  const [generating, setGenerating] = useState(false);

  async function handleSaveBank() {
    if (!drill || savingBank) return;
    setSavingBank(true);
    try {
      const res = await saveDrillAsBank(drill.id);
      if (!res.ok) return void toast.error(res.message);
      toast.success(`已存为题库（${res.data.count} 题），在「题库」页能看到`);
    } finally {
      setSavingBank(false);
    }
  }

  async function handleGenerate() {
    if (!selectedResumeId || generating) return;
    if (drill && Object.keys(drill.answers).length > 0) {
      const ok = window.confirm("重新生成会换一套追问，已经答过的记录会清空，确定？");
      if (!ok) return;
    }
    setGenerating(true);
    try {
      const res = await generateResumeDrill({
        resumeVersionId: selectedResumeId,
        positionId: positionId === NONE ? null : positionId,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setDrill(res.data);
      toast.success(`找到 ${res.data.tree.projects.length} 段经历，共 ${countQuestions(res.data)} 个追问`);
    } finally {
      setGenerating(false);
    }
  }

  function handleAnswered(questionId: string, record: DrillAnswer) {
    setDrill((d) => (d ? { ...d, answers: { ...d.answers, [questionId]: record } } : d));
  }

  if (!hasOwnKey) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            生成追问树要读整份简历，每次作答都要 AI 评分——请先去{" "}
            <a href="/settings" className="text-primary underline underline-offset-4">
              账号设置
            </a>{" "}
            配置你自己的 AI API Key 才能用。
          </p>
        </CardContent>
      </Card>
    );
  }

  if (resumeVersions.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">还没有简历——先去简历版本页上传一份。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>选简历，生成追问树</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">用哪份简历</Label>
              <Select
                value={selectedResumeId ?? ""}
                onValueChange={(v) => v && router.push(`/resume-drill?resume=${encodeURIComponent(v)}`)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {() => resumeVersions.find((r) => r.id === selectedResumeId)?.name ?? "选简历"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {resumeVersions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      {r.isDefault ? "（默认）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">针对哪个岗位追问（可不选）</Label>
              <Select value={positionId} onValueChange={(v) => v && setPositionId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {() =>
                      positionId === NONE
                        ? "不选，按简历本身追问"
                        : (positions.find((p) => p.id === positionId)?.label ?? "选岗位")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>不选，按简历本身追问</SelectItem>
                  {positions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={generating || !selectedResumeId} onClick={handleGenerate}>
              {drill ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
              {generating ? "AI 正在读简历…" : drill ? "重新生成追问树" : "生成追问树"}
            </Button>
            {drill && (
              <>
                <Button type="button" variant="outline" disabled={savingBank} onClick={handleSaveBank} title="把追问和你的作答存成一份题库，方便面试前复习">
                  <Library className="size-4" />
                  {savingBank ? "保存中…" : "存为题库"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {drill.positionLabel ? `针对：${drill.positionLabel} · ` : ""}
                  生成于 {new Date(drill.updatedAt).toLocaleString("zh-CN")}
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {drill && <Progress drill={drill} />}

      {drill?.tree.projects.map((project, index) => (
        <ProjectCard
          key={project.id}
          index={index}
          project={project}
          drillId={drill.id}
          answers={drill.answers}
          onAnswered={handleAnswered}
        />
      ))}
    </div>
  );
}

function countQuestions(drill: ResumeDrillDTO) {
  return drill.tree.projects.reduce((n, p) => n + p.questions.length, 0);
}

function Progress({ drill }: { drill: ResumeDrillDTO }) {
  const total = countQuestions(drill);
  const answered = Object.keys(drill.answers).length;
  const scores = Object.values(drill.answers).map((a) => a.score);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  // Which project the interviewer would most likely trip you on: lowest
  // average among answered, else the first one you haven't touched.
  const weakest = drill.tree.projects
    .map((p) => {
      const s = p.questions.map((q) => drill.answers[q.id]?.score).filter((x): x is number => x != null);
      return { name: p.name, avg: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null };
    })
    .filter((p) => p.avg != null)
    .sort((a, b) => a.avg! - b.avg!)[0];

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <span>
        已答 <b>{answered}</b> / {total}
      </span>
      {avg != null && (
        <span>
          平均 <b>{avg.toFixed(1)}</b> / 10
        </span>
      )}
      {weakest && weakest.avg != null && weakest.avg < 7 && (
        <span className="text-muted-foreground">
          最容易被问穿的经历：<b className="text-foreground">{weakest.name}</b>（{weakest.avg.toFixed(1)} 分）
        </span>
      )}
    </div>
  );
}

function ProjectCard({
  index,
  project,
  drillId,
  answers,
  onAnswered,
}: {
  index: number;
  project: DrillProject;
  drillId: string;
  answers: Record<string, DrillAnswer>;
  onAnswered: (questionId: string, record: DrillAnswer) => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const levels = [1, 2, 3].map((level) => ({
    level,
    questions: project.questions.filter((q) => q.level === level),
  }));
  const answeredCount = project.questions.filter((q) => answers[q.id]).length;
  const levelAnswered = (level: number) =>
    project.questions.some((q) => q.level === level && answers[q.id]);

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <span className="text-muted-foreground">#{index + 1}</span>
              {project.name}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{project.summary}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={answeredCount === project.questions.length ? "default" : "secondary"}>
              {answeredCount}/{project.questions.length}
            </Badge>
            <ChevronDown className={open ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"} />
          </div>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-5">
          {levels.map(({ level, questions }) => {
            if (questions.length === 0) return null;
            // Layered on purpose: an interviewer never opens with the L3
            // probe, and answering L2 without having framed the project in
            // L1 produces answers that don't connect. Unlock one level at a time.
            const locked = level > 1 && !levelAnswered(level - 1);
            return (
              <div key={level} className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {locked && <Lock className="size-3.5 text-muted-foreground" />}
                  <span className={locked ? "text-muted-foreground" : ""}>{LEVEL_LABEL[level]}</span>
                  {locked && (
                    <span className="text-xs font-normal text-muted-foreground">先答上一层再解锁</span>
                  )}
                </div>
                {questions.map((q) => (
                  <QuestionBlock
                    key={q.id}
                    question={q}
                    drillId={drillId}
                    record={answers[q.id]}
                    locked={locked}
                    onAnswered={onAnswered}
                  />
                ))}
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

function scoreTone(score: number) {
  if (score >= 8) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 5) return "text-amber-600 dark:text-amber-400";
  return "text-destructive";
}

function QuestionBlock({
  question,
  drillId,
  record,
  locked,
  onAnswered,
}: {
  question: DrillQuestion;
  drillId: string;
  record?: DrillAnswer;
  locked: boolean;
  onAnswered: (questionId: string, record: DrillAnswer) => void;
}) {
  const [draft, setDraft] = useState(record?.answer ?? "");
  const [editing, setEditing] = useState(!record);
  const [submitting, setSubmitting] = useState(false);
  const [showHints, setShowHints] = useState(false);

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await answerDrillQuestion({ drillId, questionId: question.id, answer: draft });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onAnswered(question.id, res.data);
      setEditing(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={locked ? "rounded-lg border border-dashed p-4 opacity-60" : "rounded-lg border p-4"}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{question.question}</p>
        {record && (
          <span className={`shrink-0 text-lg font-semibold ${scoreTone(record.score)}`}>
            {record.score}
            <span className="text-xs font-normal text-muted-foreground"> /10</span>
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">面试官想验证：{question.intent}</p>

      {!locked && (
        <div className="mt-3 space-y-3">
          {editing ? (
            <>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                placeholder="像面试时口头回答那样写，说具体的：你做了什么、为什么这样做、结果是什么"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={submitting || draft.trim().length < 10} onClick={handleSubmit}>
                  {submitting ? "面试官在听…" : record ? "重新提交" : "提交回答"}
                </Button>
                {record && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    取消
                  </Button>
                )}
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  onClick={() => setShowHints((s) => !s)}
                >
                  {showHints ? "收起要点" : "卡住了？看要点提示"}
                </button>
              </div>
              {showHints && (
                <ul className="list-disc space-y-0.5 rounded-md bg-muted/50 py-2 pr-3 pl-7 text-xs text-muted-foreground">
                  {question.keyPoints.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            record && (
              <div className="space-y-3 text-sm">
                <div className="rounded-md bg-muted/40 p-3">
                  <p className="mb-1 text-xs text-muted-foreground">你的回答</p>
                  <p className="whitespace-pre-wrap">{record.answer}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">面试官点评</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{record.feedback}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">更好的说法</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{record.betterAnswer}</p>
                </div>
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                  <p className="mb-1 text-xs font-medium">听完这个回答，面试官接下来会问</p>
                  <p>{record.followUp}</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                  再答一次
                </Button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
