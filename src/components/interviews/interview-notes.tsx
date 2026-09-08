"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BookOpen, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STAGE_BADGE_VARIANT, STAGE_LABELS } from "@/lib/stage-labels";
import {
  extractInterviewQuestions,
  type ExtractedQuestion,
} from "@/lib/actions/interview-note-extract";
import type { ApplicationStage } from "@prisma/client";

export type InterviewNote = {
  id: string;
  stage: ApplicationStage;
  enteredAt: string;
  note: string | null;
  interviewFormat: string | null;
  interviewer: string | null;
  applicationId: string;
  companyName: string;
  title: string;
  extractedQuestions: ExtractedQuestion[] | null;
};

export function InterviewNotes({ notes }: { notes: InterviewNote[] }) {
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("ALL");
  const [companyFilter, setCompanyFilter] = useState("ALL");
  // Seeded from the server-cached extraction (InterviewNoteExtract), then
  // updated locally the moment a fresh extraction finishes — waiting for
  // revalidatePath's server round-trip to reflect it would feel laggy for
  // something the user just clicked.
  const [extracted, setExtracted] = useState<Record<string, ExtractedQuestion[]>>(() =>
    Object.fromEntries(
      notes.filter((n) => n.extractedQuestions).map((n) => [n.id, n.extractedQuestions!])
    )
  );
  const [extractingId, setExtractingId] = useState<string | null>(null);

  async function handleExtract(noteId: string) {
    setExtractingId(noteId);
    try {
      const res = await extractInterviewQuestions(noteId);
      if (res.ok) {
        setExtracted((prev) => ({ ...prev, [noteId]: res.data }));
        if (res.data.length === 0) toast.info("这条笔记里没有提取到具体问题");
      } else {
        toast.error(res.message);
      }
    } finally {
      setExtractingId(null);
    }
  }

  const companies = useMemo(
    () => [...new Set(notes.map((n) => n.companyName))].sort(),
    [notes]
  );
  const stages = useMemo(
    () => [...new Set(notes.map((n) => n.stage))],
    [notes]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      const questions = extracted[n.id] ?? [];
      const matchesQuery =
        !q ||
        (n.note ?? "").toLowerCase().includes(q) ||
        n.companyName.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        (n.interviewer ?? "").toLowerCase().includes(q) ||
        questions.some(
          (eq) =>
            eq.question.toLowerCase().includes(q) || eq.category.toLowerCase().includes(q)
        );
      const matchesStage = stageFilter === "ALL" || n.stage === stageFilter;
      const matchesCompany =
        companyFilter === "ALL" || n.companyName === companyFilter;
      return matchesQuery && matchesStage && matchesCompany;
    });
  }, [notes, query, stageFilter, companyFilter, extracted]);

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
        <BookOpen className="size-8 text-muted-foreground/50" />
        <span className="text-sm">
          还没有面试记录。在投递详情页添加进展时写的复盘笔记会汇总到这里
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索笔记内容、公司、岗位、面试官"
          className="sm:max-w-xs"
        />
        <Select
          value={stageFilter}
          onValueChange={(v) => setStageFilter(v ?? "ALL")}
        >
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue>
              {(v: string) =>
                v === "ALL" ? "全部阶段" : STAGE_LABELS[v as ApplicationStage]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部阶段</SelectItem>
            {stages.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={companyFilter}
          onValueChange={(v) => setCompanyFilter(v ?? "ALL")}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue>{(v: string) => (v === "ALL" ? "全部公司" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部公司</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">
        共 {filtered.length} 条记录
      </p>

      <div className="space-y-3">
        {filtered.map((n) => (
          <Card key={n.id}>
            <CardContent className="space-y-2 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STAGE_BADGE_VARIANT[n.stage]}>
                  {STAGE_LABELS[n.stage]}
                </Badge>
                <span className="font-medium">{n.companyName}</span>
                <span className="text-sm text-muted-foreground">{n.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(n.enteredAt).toLocaleDateString()}
                </span>
              </div>

              {(n.interviewFormat || n.interviewer) && (
                <p className="text-xs text-muted-foreground">
                  {n.interviewFormat}
                  {n.interviewFormat && n.interviewer && " · "}
                  {n.interviewer}
                </p>
              )}

              {n.note && (
                <p className="whitespace-pre-wrap text-sm">{n.note}</p>
              )}

              {n.note &&
                (extracted[n.id] === undefined ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={extractingId === n.id}
                    onClick={() => handleExtract(n.id)}
                  >
                    <Sparkles className="size-3.5" />
                    {extractingId === n.id ? "提取中..." : "AI 提取问题清单"}
                  </Button>
                ) : extracted[n.id].length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {extracted[n.id].map((eq, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-muted px-2.5 py-1 text-xs"
                        title={eq.category}
                      >
                        {eq.category}：{eq.question}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">没有提取到具体问题</p>
                ))}

              <Link
                href={`/applications/${n.applicationId}`}
                className="inline-block text-xs text-primary underline underline-offset-4"
              >
                查看这条投递
              </Link>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center text-muted-foreground">
            <BookOpen className="size-8 text-muted-foreground/50" />
            <span className="text-sm">没有匹配的面试记录</span>
          </div>
        )}
      </div>
    </div>
  );
}
