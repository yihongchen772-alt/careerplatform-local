"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Sparkles, ChevronDown, Tags, GraduationCap, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  importQuestionBank,
  deleteQuestionBank,
  fillBankAnswers,
  classifyBankModules,
  updateQuestionModule,
  getQuestionBank,
  type QuestionBankSummary,
} from "@/lib/actions/question-banks";
import { startExam, type ExamSummary } from "@/lib/actions/exam";

/** ~2.5 minutes per question, rounded to a friendly number — advisory only. */
function suggestedDuration(questionCount: number): number {
  return Math.max(5, Math.round((questionCount * 2.5) / 5) * 5);
}
import {
  toBankFile,
  toBankMarkdown,
  type QuestionBankItem,
} from "@/lib/question-bank-shared";
import { ExamHistory } from "@/components/question-banks/exam-history";

const UNCLASSIFIED = "未分类";

/**
 * Triggers a download of text the page generated. Blob + object URL rather
 * than a data: URI — question banks with reference answers run to tens of
 * kilobytes, past what some browsers accept in a data: URL.
 */
function download(filename: string, body: string, mime: string) {
  const url = URL.createObjectURL(new Blob([body], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function QuestionBanksView({
  banks,
  exams,
}: {
  banks: QuestionBankSummary[];
  exams: ExamSummary[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          导入别人分享的题库，或把 AI 给某条投递生成的题库存下来复用。也可以导出成文件发给同学。
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button size="sm">
                <Upload className="mr-1.5 size-4" />
                导入题库
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>导入题库</DialogTitle>
            </DialogHeader>
            <ImportForm onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {banks.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          还没有题库。可以先导入一份，或者去某条投递里生成面试题库后点「存进题库」。
        </div>
      ) : (
        <div className="space-y-2">
          {banks.map((b) => (
            <BankRow key={b.id} bank={b} />
          ))}
        </div>
      )}

      {exams.length > 0 && <ExamHistory exams={exams} />}
    </div>
  );
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleFile(file: File) {
    const text = await file.text();
    setRaw(text);
    if (!name) setName(file.name.replace(/\.(json|txt|md)$/i, ""));
  }

  async function handleImport() {
    setLoading(true);
    try {
      const res = await importQuestionBank({ name, source: source || undefined, raw });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`已导入 ${res.data.count} 道题`);
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">题库名称</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="比如：字节后端一面高频题"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">来源（可选）</Label>
        <Input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="哪里来的，方便以后想起来"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          题目内容（粘贴，或选一个导出的 .json 文件）
        </Label>
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={8}
          placeholder={"一行一道题，直接从群里复制粘贴就行：\n# C++\n1. 讲一下 vector 的扩容机制\n\n# Python\n2. GIL 是什么\n\n开头写「# 模块名」会把下面的题目自动分到那个模块，不写也没关系。或者粘贴导出的 JSON。"}
        />
        <input
          type="file"
          accept=".json,.txt,.md"
          className="mt-1 block w-full text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <p className="text-xs text-muted-foreground">
          开头的「1.」「-」「Q1:」这类编号会自动去掉。
        </p>
      </div>
      <Button size="sm" disabled={loading || !name.trim() || !raw.trim()} onClick={handleImport}>
        {loading ? "导入中..." : "导入"}
      </Button>
    </div>
  );
}

function BankRow({ bank }: { bank: QuestionBankSummary }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [questions, setQuestions] = useState<QuestionBankItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [examOpen, setExamOpen] = useState(false);

  async function load(): Promise<QuestionBankItem[] | null> {
    if (questions) return questions;
    const res = await getQuestionBank(bank.id);
    if (!res.ok) {
      toast.error(res.message);
      return null;
    }
    setQuestions(res.data.questions);
    return res.data.questions;
  }

  async function toggle() {
    if (!expanded) await load();
    setExpanded((v) => !v);
  }

  async function handleExport(kind: "json" | "md") {
    const items = await load();
    if (!items) return;
    const payload = { name: bank.name, source: bank.source, questions: items };
    if (kind === "json") {
      download(`${bank.name}.json`, toBankFile(payload), "application/json");
    } else {
      download(`${bank.name}.md`, toBankMarkdown(payload), "text/markdown");
    }
  }

  async function handleFill() {
    setBusy(true);
    try {
      const res = await fillBankAnswers(bank.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`补了 ${res.data.filled} 道题的参考思路`);
      setQuestions(null);
      if (expanded) await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleClassify() {
    setBusy(true);
    try {
      const res = await classifyBankModules(bank.id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`给 ${res.data.classified} 道题标了模块`);
      setQuestions(null);
      if (expanded) await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleModuleChange(index: number, module: string) {
    const res = await updateQuestionModule(bank.id, index, module || null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setQuestions((prev) =>
      prev ? prev.map((q, i) => (i === index ? { ...q, module: module || null } : q)) : prev
    );
  }

  const unfilledCount = bank.count - bank.answered;
  const hasUnclassified = questions
    ? questions.some((q) => !q.module)
    : bank.modules.length === 0 && bank.count > 0;

  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={toggle}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <ChevronDown
              className={`size-4 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
            />
            <span className="truncate text-sm font-medium">{bank.name}</span>
            <Badge variant="secondary">{bank.count} 题</Badge>
            {unfilledCount > 0 && <Badge variant="outline">{unfilledCount} 题无参考思路</Badge>}
          </button>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={bank.count < 3}
              onClick={() => setExamOpen(true)}
              title={bank.count < 3 ? "至少 3 道题才能开考" : undefined}
            >
              <GraduationCap className="mr-1.5 size-4" />
              模拟考试
            </Button>
            {hasUnclassified && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={handleClassify}>
                <Tags className="mr-1.5 size-4" />
                {busy ? "分类中..." : "AI 分模块"}
              </Button>
            )}
            {unfilledCount > 0 && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={handleFill}>
                <Sparkles className="mr-1.5 size-4" />
                {busy ? "生成中..." : "AI 补参考思路"}
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => handleExport("json")}>
              <Download className="mr-1.5 size-4" />
              JSON
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => handleExport("md")}>
              Markdown
            </Button>
            <ConfirmDeleteButton
              trigger={
                <Button type="button" variant="ghost" size="sm">
                  删除
                </Button>
              }
              title={`删除题库「${bank.name}」？`}
              onConfirm={async () => {
                const res = await deleteQuestionBank(bank.id);
                if (!res.ok) toast.error(res.message);
                else toast.success("已删除");
              }}
            />
          </div>
        </div>

        {bank.source && (
          <p className="pl-6 text-xs text-muted-foreground">来源：{bank.source}</p>
        )}
        {bank.modules.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-6">
            {bank.modules.map((m) => (
              <Badge key={m} variant="outline" className="text-xs">
                {m}
              </Badge>
            ))}
          </div>
        )}

        {expanded && questions && <GroupedQuestions questions={questions} onModuleChange={handleModuleChange} />}

        {examOpen && (
          <ExamStartDialog
            bank={bank}
            onClose={() => setExamOpen(false)}
            onStarted={(examId) => router.push(`/question-banks/exam/${examId}`)}
          />
        )}
      </CardContent>
    </Card>
  );
}

function GroupedQuestions({
  questions,
  onModuleChange,
}: {
  questions: QuestionBankItem[];
  onModuleChange: (index: number, module: string) => void;
}) {
  const groups = useMemo(() => {
    const byModule = new Map<string, { q: QuestionBankItem; i: number }[]>();
    questions.forEach((q, i) => {
      const key = q.module || UNCLASSIFIED;
      if (!byModule.has(key)) byModule.set(key, []);
      byModule.get(key)!.push({ q, i });
    });
    // Unclassified last — it's the "still needs work" pile, not the content.
    return Array.from(byModule.entries()).sort(([a], [b]) => {
      if (a === UNCLASSIFIED) return 1;
      if (b === UNCLASSIFIED) return -1;
      return a.localeCompare(b, "zh");
    });
  }, [questions]);

  return (
    <div className="space-y-4 pl-6 pt-1">
      {groups.map(([module, items]) => (
        <div key={module} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{module}</span>
            <Badge variant="secondary" className="text-xs">
              {items.length}
            </Badge>
          </div>
          <ol className="space-y-3">
            {items.map(({ q, i }) => (
              <QuestionRow key={i} q={q} index={i} onModuleChange={onModuleChange} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function QuestionRow({
  q,
  index,
  onModuleChange,
}: {
  q: QuestionBankItem;
  index: number;
  onModuleChange: (index: number, module: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(q.module ?? "");

  function save() {
    onModuleChange(index, value.trim());
    setEditing(false);
  }

  return (
    <li className="space-y-1 border-l-2 pl-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="font-medium">
          {index + 1}. {q.question}
        </p>
        {q.category && (
          <Badge variant="outline" className="text-xs">
            {q.category}
          </Badge>
        )}
      </div>
      {editing ? (
        <div className="flex items-center gap-1">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) save();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="模块名，比如 C++"
            className="h-7 w-40 text-xs"
            autoFocus
          />
          <Button size="icon" className="size-7 shrink-0" aria-label="保存模块名" onClick={save}>
            <Check className="size-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3" />
          {q.module || "标个模块"}
        </button>
      )}
      {q.referenceAnswer && (
        <p className="whitespace-pre-wrap text-muted-foreground">{q.referenceAnswer}</p>
      )}
      {q.tips && <p className="text-xs text-muted-foreground">提示：{q.tips}</p>}
    </li>
  );
}

function ExamStartDialog({
  bank,
  onClose,
  onStarted,
}: {
  bank: QuestionBankSummary;
  onClose: () => void;
  onStarted: (examId: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(bank.modules));
  const [count, setCount] = useState(Math.min(10, bank.count));
  const [duration, setDuration] = useState(suggestedDuration(Math.min(10, bank.count)));
  const [starting, setStarting] = useState(false);

  function toggle(m: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  function handleCountChange(next: number) {
    setCount(next);
    setDuration(suggestedDuration(next));
  }

  async function handleStart() {
    setStarting(true);
    try {
      const modules = bank.modules.length > 0 && selected.size < bank.modules.length
        ? Array.from(selected)
        : null;
      const res = await startExam({ bankId: bank.id, modules, count, durationMinutes: duration });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onStarted(res.data.id);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>开始模拟考试 · {bank.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {bank.modules.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                考哪些模块（不选就是整个题库）
              </Label>
              <div className="flex flex-wrap gap-2">
                {bank.modules.map((m) => (
                  <label
                    key={m}
                    className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
                  >
                    <Checkbox checked={selected.has(m)} onCheckedChange={() => toggle(m)} />
                    {m}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">题目数量</Label>
              <Input
                type="number"
                min={3}
                max={30}
                value={count}
                onChange={(e) => handleCountChange(Number(e.target.value) || 3)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">时长（分钟）</Label>
              <Input
                type="number"
                min={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value) || 5)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            题目会从选中的范围里随机抽取。时间到了会自动交卷，已经填的作答都会送去打分。
          </p>
          <Button disabled={starting} onClick={handleStart}>
            {starting ? "准备中..." : "开始"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
