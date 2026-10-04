"use client";

import { useState } from "react";
import { Check, Clock3, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptPendingApplicationChange, ignorePendingApplicationChange } from "@/lib/actions/pending-application-change";
import { MEMORY_CATEGORIES, sameMemoryEntity, normalizeMemoryText, type MemoryCapture, type MemoryContent, type MemoryView } from "@/lib/application-memory";
import type { MemoryAnswer } from "@/components/settings/autofill-memory-card";
import type { PendingAnswer, PendingApplicationChangeView } from "@/lib/pending-application-change";

const contentLabels: Record<string, string> = { name: "名称", company: "公司 / 单位", school: "学校", role: "职位 / 角色", major: "专业", degree: "学历", gpa: "GPA", start: "开始时间", end: "结束时间", date: "时间", issuer: "颁发单位", level: "等级", description: "描述 / 成果", responsibilities: "职责与成果", text: "整段原文" };

function sourceName(url: string) {
  try { return new URL(url).hostname; } catch { return "网申页面"; }
}

export function PendingApplicationChangesCard({ initial, currentMemories, currentAnswers, currentFacts }: { initial: PendingApplicationChangeView[]; currentMemories: MemoryView[]; currentAnswers: MemoryAnswer[]; currentFacts: Record<string, string | null> }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const rows = initial.filter((row) => !removed.includes(`${row.id}:${row.revision}`));
  const [scope, setScope] = useState<Record<string, "local" | "global">>({});
  const [recordPreference, setRecordPreference] = useState<Record<string, "version" | "replace">>({});
  const [busyId, setBusyId] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, MemoryContent>>({});
  const [answerEdits, setAnswerEdits] = useState<Record<string, string>>({});
  const [enableAutomatic, setEnableAutomatic] = useState<Record<string, boolean>>({});
  const reviewKey = (row: PendingApplicationChangeView) => `${row.id}:${row.revision}`;
  function targetFor(row: PendingApplicationChangeView) {
    if (row.kind !== "record") return undefined;
    const record = row.payload as MemoryCapture;
    const matches = currentMemories.filter((item) => item.category === record.category && sameMemoryEntity(record.category, item.content, record.content));
    const id = targets[reviewKey(row)] ?? (matches.length === 1 ? matches[0].id : "new");
    return currentMemories.find((item) => item.id === id);
  }
  function contentFor(row: PendingApplicationChangeView, target = targetFor(row)) {
    const record = row.payload as MemoryCapture;
    return edits[reviewKey(row)] || (target ? { ...target.content, ...Object.fromEntries(Object.entries(record.content).filter(([, value]) => value)) } : { ...record.content });
  }
  function answerFor(row: PendingApplicationChangeView) {
    const payload = row.payload as PendingAnswer;
    const context = (scope[reviewKey(row)] || "local") === "global" ? null : row.contextKey;
    return currentAnswers.find((item) => item.contextKey === context && item.kind === payload.kind && normalizeMemoryText(item.questionLabel) === normalizeMemoryText(payload.questionLabel));
  }

  async function accept(row: PendingApplicationChangeView) {
    setBusyId(row.id);
    try {
      const res = await acceptPendingApplicationChange(row.id, {
        revision: row.revision,
        shareAcrossCompanies: (scope[reviewKey(row)] || "local") === "global",
        recordPreference: recordPreference[reviewKey(row)] || "version",
        target: targetFor(row) ? { id: targetFor(row)!.id, revision: targetFor(row)!.revision } : null,
        expectedAnswer: row.kind === "answer" && answerFor(row) ? { id: answerFor(row)!.id, updatedAt: answerFor(row)!.updatedAt } : null,
        content: row.kind === "record" ? contentFor(row) : undefined,
        answer: row.kind === "answer" ? answerEdits[reviewKey(row)] : undefined,
        enableAutomatic: enableAutomatic[reviewKey(row)] || false,
      });
      if (!res.ok) return void toast.error(res.message);
      setRemoved((current) => [...current, reviewKey(row)]);
      toast.success(row.kind === "record" ? "已加入我的资料，之后可选择使用" : "已确认保存范围，下次可按该范围使用");
    } finally { setBusyId(""); }
  }

  async function ignore(row: PendingApplicationChangeView) {
    setBusyId(row.id);
    try {
      const res = await ignorePendingApplicationChange(row.id, row.revision);
      if (!res.ok) return void toast.error(res.message);
      setRemoved((current) => [...current, reviewKey(row)]);
      toast.success("已忽略；本次申请草稿不会受影响");
    } finally { setBusyId(""); }
  }

  return <Card id="pending-application-changes" className="scroll-mt-6 md:col-span-2">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2"><Clock3 className="size-5" />待核对变化{rows.length ? `（${rows.length}）` : ""}</CardTitle>
      </div>
      <p className="text-sm text-muted-foreground">这里是网申页面上新手填或修改的内容。它们已保留，但在你确认前不会进入正式资料，也不会影响下一次自动填写。</p>
    </CardHeader>
    <CardContent>
      {!rows.length ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">没有待核对内容。填写进度仍会作为本次申请草稿自动保存。</div> : <div className="space-y-3">
        {rows.map((row) => {
          const answer = row.kind === "answer" ? row.payload as PendingAnswer : null;
          const record = row.kind === "record" ? row.payload as MemoryCapture : null;
          const matchingMemory = targetFor(row);
          const savedAnswer = answer ? answerFor(row) : null;
          const fallbackAnswer = answer && !savedAnswer ? currentAnswers.find((item) => !item.contextKey && item.kind === answer.kind && normalizeMemoryText(item.questionLabel) === normalizeMemoryText(answer.questionLabel))?.answer || (answer.kind === "field" ? currentFacts[answer.questionLabel] : null) : null;
          const selectedScope = scope[reviewKey(row)] || "local";
          return <article key={reviewKey(row)} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium">{row.label}</h3>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  来自 {sourceName(row.sourceUrl)} · {new Date(row.createdAt).toLocaleDateString("zh-CN")}
                  <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">查看来源<ExternalLink className="size-3" /></a>
                </p>
              </div>
              <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{record ? MEMORY_CATEGORIES[record.category] : answer?.kind === "field" ? "基础字段" : "开放题"}</span>
            </div>
            {answer && <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">准备保存的内容</p>
              <Textarea aria-label={`${row.label}确认内容`} value={answerEdits[reviewKey(row)] ?? answer.answer} onChange={(event) => setAnswerEdits((current) => ({ ...current, [reviewKey(row)]: event.target.value }))} />
            </div>}
            {record && <div className="mt-3 grid gap-2 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2">
              {Object.entries(contentFor(row)).map(([key, value]) => <label key={key} className={/description|responsibilities|text/.test(key) ? "sm:col-span-2" : ""}><span className="text-xs text-muted-foreground">{contentLabels[key] || key}</span><Textarea aria-label={`${row.label} ${contentLabels[key] || key}`} rows={/description|responsibilities|text/.test(key) ? 4 : 1} value={value} onChange={(event) => setEdits((current) => ({ ...current, [reviewKey(row)]: { ...contentFor(row), [key]: event.target.value } }))} /></label>)}
            </div>}
            {record && <label className="mt-3 block text-sm">保存到哪条经历<select aria-label={`${row.label}保存归属`} className="ml-2 rounded border bg-background p-2" value={matchingMemory?.id || "new"} onChange={(event) => { setTargets((current) => ({ ...current, [reviewKey(row)]: event.target.value })); setRecordPreference((current) => ({ ...current, [reviewKey(row)]: "version" })); setEdits((current) => { const next = { ...current }; delete next[reviewKey(row)]; return next; }); }}><option value="new">作为新的经历</option>{currentMemories.filter((item) => item.category === record.category).map((item) => <option key={item.id} value={item.id}>{item.content.name || item.content.company || item.content.school || "整段原文"} · {item.content.start || item.content.date || "日期未填"}</option>)}</select></label>}
            {record && matchingMemory && <details className="mt-3 rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">与资料库当前默认版比较</summary>
              <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{Object.entries(matchingMemory.content).filter(([, value]) => value).map(([key, value]) => `${contentLabels[key] || key}：${value}`).join("\n")}</div>
            </details>}
            {answer && <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name={`scope-${row.id}`} checked={selectedScope === "local"} onChange={() => setScope((current) => ({ ...current, [reviewKey(row)]: "local" }))} />只用于当前岗位 / 网页</label>
              <label className="flex items-center gap-2"><input type="radio" name={`scope-${row.id}`} checked={selectedScope === "global"} onChange={() => setScope((current) => ({ ...current, [reviewKey(row)]: "global" }))} />跨企业复用</label>
            </div>}
            {savedAnswer && <div className="mt-3 rounded border p-3 text-sm"><p className="text-xs text-muted-foreground">所选范围内当前使用的回答（确认后旧版仍保留在问答库）</p><p className="mt-1 whitespace-pre-wrap">{savedAnswer.answer}</p></div>}
            {fallbackAnswer && <div className="mt-3 rounded border p-3 text-sm"><p className="text-xs text-muted-foreground">当前回退使用的通用资料（保存为本岗位回答后，其他岗位仍使用通用资料）</p><p className="mt-1 whitespace-pre-wrap">{fallbackAnswer}</p></div>}
            {record && matchingMemory && <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name={`record-${row.id}`} checked={(recordPreference[reviewKey(row)] || "version") === "version"} onChange={() => setRecordPreference((current) => ({ ...current, [reviewKey(row)]: "version" }))} />保留为另一版，当前默认不变</label>
              <label className="flex items-center gap-2"><input type="radio" name={`record-${row.id}`} checked={recordPreference[reviewKey(row)] === "replace"} onChange={() => setRecordPreference((current) => ({ ...current, [reviewKey(row)]: "replace" }))} />设为经历库默认版</label>
            </div>}
            {record && <p className="mt-3 text-xs text-muted-foreground">另存版本不会补写或改动当前默认内容。网申资料方案中手动维护的同一段经历仍优先；需要更新方案时请在「网申资料」修改。</p>}
            {record && !matchingMemory && <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={enableAutomatic[reviewKey(row)] || false} onChange={(event) => setEnableAutomatic((current) => ({ ...current, [reviewKey(row)]: event.target.checked }))} />同时加入默认自动填写（留空时仅在预览中手动选择）</label>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={!!busyId} onClick={() => ignore(row)}><X className="size-4" />仅保留本次 / 忽略</Button>
              <Button size="sm" disabled={!!busyId} onClick={() => accept(row)}><Check className="size-4" />{record ? "加入我的资料" : "确认保存"}</Button>
            </div>
          </article>;
        })}
      </div>}
    </CardContent>
  </Card>;
}
