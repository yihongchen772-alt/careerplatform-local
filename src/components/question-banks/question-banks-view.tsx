"use client";

import { useState } from "react";
import { Download, Upload, Sparkles, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  getQuestionBank,
  type QuestionBankSummary,
} from "@/lib/actions/question-banks";
import {
  toBankFile,
  toBankMarkdown,
  type QuestionBankItem,
} from "@/lib/question-bank-shared";

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

export function QuestionBanksView({ banks }: { banks: QuestionBankSummary[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
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
          placeholder={"一行一道题，直接从群里复制粘贴就行：\n1. 讲一下你最有挑战的项目\n2. HashMap 的扩容机制\n\n或者粘贴导出的 JSON。"}
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
  const [expanded, setExpanded] = useState(false);
  const [questions, setQuestions] = useState<QuestionBankItem[] | null>(null);
  const [busy, setBusy] = useState(false);

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
      // Drop the cache so the next expand shows the freshly written answers.
      setQuestions(null);
      if (expanded) await load();
    } finally {
      setBusy(false);
    }
  }

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
            {bank.answered < bank.count && (
              <Badge variant="outline">{bank.count - bank.answered} 题无参考思路</Badge>
            )}
          </button>
          <div className="flex flex-wrap items-center gap-1">
            {bank.answered < bank.count && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={handleFill}
              >
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

        {expanded && questions && (
          <ol className="space-y-3 pl-6 pt-1">
            {questions.map((q, i) => (
              <li key={i} className="space-y-1 border-l-2 pl-3 text-sm">
                <p className="font-medium">
                  {i + 1}. {q.question}
                </p>
                {q.category && (
                  <Badge variant="outline" className="text-xs">
                    {q.category}
                  </Badge>
                )}
                {q.referenceAnswer && (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {q.referenceAnswer}
                  </p>
                )}
                {q.tips && <p className="text-xs text-muted-foreground">提示：{q.tips}</p>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
