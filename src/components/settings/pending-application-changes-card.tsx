"use client";

import { useState } from "react";
import { Check, ChevronRight, ExternalLink, Inbox, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { acceptPendingApplicationChange, acceptPendingIntoProfile, ignorePendingApplicationChange, ignorePendingApplicationChanges } from "@/lib/actions/pending-application-change";
import { MEMORY_CATEGORIES, sameMemoryEntity, normalizeMemoryText, type MemoryCapture, type MemoryContent, type MemoryView } from "@/lib/application-memory";
import { companySpecificQuestion } from "@/lib/autofill-answer-scope";
import type { MemoryAnswer } from "@/components/settings/autofill-memory-card";
import type { PendingAnswer, PendingApplicationChangeView } from "@/lib/pending-application-change";

const contentLabels: Record<string, string> = { name: "名称", company: "公司 / 单位", school: "学校", department: "院系 / 部门", role: "职位 / 角色", major: "专业", degree: "学历", gpa: "GPA", start: "开始时间", end: "结束时间", date: "时间", issuer: "颁发单位", level: "等级 / 程度", category: "类别", description: "描述 / 成果", responsibilities: "职责与成果", link: "项目链接", text: "整段原文", score: "分数", language: "语种" };

function sourceName(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "网申页面"; }
}

/** One 网申: the same position, or else the same site. */
function groupKey(row: PendingApplicationChangeView) {
  return row.contextKey?.startsWith("job:") ? row.contextKey : `site:${sourceName(row.sourceUrl)}`;
}

/** Whole 经历, open answers and 网申资料 fields first; other short one-off fields fold away. */
function isShortField(row: PendingApplicationChangeView) {
  return row.kind === "answer" && (row.payload as PendingAnswer).kind !== "essay" && !row.profileField;
}

function preview(row: PendingApplicationChangeView) {
  if (row.kind === "answer") return (row.payload as PendingAnswer).answer;
  const content = (row.payload as MemoryCapture).content;
  return [content.role || content.major || content.level, [content.start || content.date, content.end].filter(Boolean).join(" – "), content.description || content.responsibilities || content.text].filter(Boolean).join(" · ");
}

export function PendingApplicationChangesCard({ initial, currentMemories, currentAnswers, currentFacts, profileValues = {}, sources = {} }: { initial: PendingApplicationChangeView[]; currentMemories: MemoryView[]; currentAnswers: MemoryAnswer[]; currentFacts: Record<string, string | null>; profileValues?: Record<string, string>; sources?: Record<string, string> }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const rows = initial.filter((row) => !removed.includes(`${row.id}:${row.revision}`));
  const [scope, setScope] = useState<Record<string, "local" | "global">>({});
  const [recordPreference, setRecordPreference] = useState<Record<string, "version" | "replace">>({});
  const [busyId, setBusyId] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, MemoryContent>>({});
  const [answerEdits, setAnswerEdits] = useState<Record<string, string>>({});
  const [enableAutomatic, setEnableAutomatic] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<string | null>(null);
  const reviewKey = (row: PendingApplicationChangeView) => `${row.id}:${row.revision}`;
  // Short facts (英文名, 成绩排名) are the same everywhere; a company question stays with that company.
  const scopeFor = (row: PendingApplicationChangeView) => scope[reviewKey(row)] || (row.kind === "answer" && ((row.payload as PendingAnswer).kind === "essay" && companySpecificQuestion((row.payload as PendingAnswer).questionLabel)) ? "local" : "global");
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
    const context = scopeFor(row) === "global" ? null : row.contextKey;
    return currentAnswers.find((item) => item.contextKey === context && item.kind === payload.kind && normalizeMemoryText(item.questionLabel) === normalizeMemoryText(payload.questionLabel));
  }

  async function accept(row: PendingApplicationChangeView, toProfile = false) {
    setBusyId(row.id);
    try {
      const target = targetFor(row);
      const saved = row.kind === "answer" ? answerFor(row) : undefined;
      const res = await acceptPendingApplicationChange(row.id, {
        revision: row.revision,
        shareAcrossCompanies: scopeFor(row) === "global",
        recordPreference: recordPreference[reviewKey(row)] || "version",
        target: target ? { id: target.id, revision: target.revision } : null,
        expectedAnswer: saved ? { id: saved.id, updatedAt: saved.updatedAt } : null,
        content: row.kind === "record" ? contentFor(row) : undefined,
        answer: row.kind === "answer" ? answerEdits[reviewKey(row)] : undefined,
        enableAutomatic: enableAutomatic[reviewKey(row)] || false,
        toProfile,
      });
      if (!res.ok) return void toast.error(res.message);
      setRemoved((current) => [...current, reviewKey(row)]);
      toast.success(toProfile ? `已记进网申资料「${row.profileField?.label}」，以后网申都会自动填` : row.kind === "record" ? "已加入经历库" : "已记住，以后填写会用上");
    } finally { setBusyId(""); }
  }

  async function ignore(row: PendingApplicationChangeView) {
    setBusyId(row.id);
    try {
      const res = await ignorePendingApplicationChange(row.id, row.revision);
      if (!res.ok) return void toast.error(res.message);
      setRemoved((current) => [...current, reviewKey(row)]);
    } finally { setBusyId(""); }
  }

  // Answers whose 网申资料 field is still blank: one click writes them all in.
  // 期望城市 / 期望岗位 are usually picked for one company, so only one by one.
  const profileReady = (list: PendingApplicationChangeView[]) => list.filter((row) => row.profileField && !["preferredCities", "targetRole"].includes(row.profileField.key) && !profileValues[row.profileField.key]?.trim());
  async function acceptAllIntoProfile(list: PendingApplicationChangeView[]) {
    setBusyId("all");
    try {
      // One answer per field: the newest one wins.
      const seen = new Set<string>();
      const picked = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((row) => !seen.has(row.profileField!.key) && seen.add(row.profileField!.key));
      const res = await acceptPendingIntoProfile(picked.map((row) => ({ id: row.id, revision: row.revision })));
      if (!res.ok) return void toast.error(res.message);
      setRemoved((current) => [...current, ...picked.map(reviewKey)]);
      toast.success(`已记进网申资料 ${res.data.saved} 项${res.data.skipped ? `；${res.data.skipped} 项刚有新变化，刷新后再看` : ""}，以后网申都会自动填`);
    } finally { setBusyId(""); }
  }

  async function ignoreAll(list: PendingApplicationChangeView[], label: string) {
    setBusyId("all");
    try {
      const res = await ignorePendingApplicationChanges(list.map((row) => ({ id: row.id, revision: row.revision })));
      if (!res.ok) return void toast.error(res.message);
      setRemoved((current) => [...current, ...list.map(reviewKey)]);
      toast.success(`已忽略「${label}」的 ${res.data.ignored} 条${res.data.skipped ? `；${res.data.skipped} 条刚有新变化，刷新后再看` : ""}`);
    } finally { setBusyId(""); }
  }

  const groups = new Map<string, PendingApplicationChangeView[]>();
  for (const row of rows) groups.set(groupKey(row), [...(groups.get(groupKey(row)) ?? []), row]);

  // A render function, not a nested component: a component defined in here
  // would remount on every keystroke and drop the textarea's focus.
  function renderItem(row: PendingApplicationChangeView) {
    const key = reviewKey(row);
    const answer = row.kind === "answer" ? row.payload as PendingAnswer : null;
    const record = row.kind === "record" ? row.payload as MemoryCapture : null;
    const matchingMemory = targetFor(row);
    const savedAnswer = answer ? answerFor(row) : null;
    const fallbackAnswer = answer && !savedAnswer ? currentAnswers.find((item) => !item.contextKey && item.kind === answer.kind && normalizeMemoryText(item.questionLabel) === normalizeMemoryText(answer.questionLabel))?.answer || (answer.kind === "field" ? currentFacts[answer.questionLabel] : null) : null;
    const expanded = open === key;
    return (
      <li key={key} className="py-3 first:pt-0 last:pb-0">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
              {row.label}
              <span className="text-[11px] font-normal text-muted-foreground">{record ? `新${MEMORY_CATEGORIES[record.category]}` : row.profileField ? `网申资料 · ${row.profileField.label}` : answer?.kind === "essay" ? "问答" : "字段"}{matchingMemory ? " · 与已有经历相似" : ""}</span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{preview(row)}</p>
            {row.profileField && profileValues[row.profileField.key]?.trim() && <p className="mt-0.5 text-xs text-muted-foreground">网申资料里现在是「{profileValues[row.profileField.key].slice(0, 40)}」，记进去会替换它</p>}
            <button type="button" onClick={() => setOpen(expanded ? null : key)} className="mt-1 inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRight className={`size-3 transition-transform ${expanded ? "rotate-90" : ""}`} />调整
            </button>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" disabled={!!busyId} onClick={() => ignore(row)} aria-label={`忽略 ${row.label}`}><X className="size-3.5" />忽略</Button>
            {row.profileField
              ? <Button size="sm" variant="outline" disabled={!!busyId} onClick={() => accept(row, true)} title="写进 设置 → 网申资料，以后所有网申都按它填"><Check className="size-3.5" />记进网申资料</Button>
              : <Button size="sm" variant="outline" disabled={!!busyId} onClick={() => accept(row)}><Check className="size-3.5" />{record ? "加入经历库" : "记住"}</Button>}
          </div>
        </div>
        {expanded && (
          <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3 text-sm">
            {answer && <Textarea aria-label={`${row.label}确认内容`} value={answerEdits[key] ?? answer.answer} onChange={(event) => setAnswerEdits((current) => ({ ...current, [key]: event.target.value }))} />}
            {answer && <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><input type="radio" name={`scope-${row.id}`} checked={scopeFor(row) === "global"} onChange={() => setScope((current) => ({ ...current, [key]: "global" }))} />所有网申都用</label>
              <label className="flex items-center gap-2"><input type="radio" name={`scope-${row.id}`} checked={scopeFor(row) === "local"} onChange={() => setScope((current) => ({ ...current, [key]: "local" }))} />只用于这家 / 这个岗位</label>
            </div>}
            {savedAnswer && <div className="rounded border bg-background p-2.5"><p className="text-xs text-muted-foreground">现在用的回答（记住后旧版仍保留在问答库）</p><p className="mt-1 whitespace-pre-wrap">{savedAnswer.answer}</p></div>}
            {fallbackAnswer && <div className="rounded border bg-background p-2.5"><p className="text-xs text-muted-foreground">现在回退使用的通用资料</p><p className="mt-1 whitespace-pre-wrap">{fallbackAnswer}</p></div>}
            {record && <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(contentFor(row)).map(([field, value]) => <label key={field} className={/description|responsibilities|text/.test(field) ? "sm:col-span-2" : ""}><span className="text-xs text-muted-foreground">{contentLabels[field] || field}</span><Textarea aria-label={`${row.label} ${contentLabels[field] || field}`} rows={/description|responsibilities|text/.test(field) ? 4 : 1} value={value} onChange={(event) => setEdits((current) => ({ ...current, [key]: { ...contentFor(row), [field]: event.target.value } }))} /></label>)}
            </div>}
            {record && <label className="block">保存到<select aria-label={`${row.label}保存归属`} className="ml-2 rounded border bg-background p-1.5" value={matchingMemory?.id || "new"} onChange={(event) => { setTargets((current) => ({ ...current, [key]: event.target.value })); setRecordPreference((current) => ({ ...current, [key]: "version" })); setEdits((current) => { const next = { ...current }; delete next[key]; return next; }); }}><option value="new">新的一段经历</option>{currentMemories.filter((item) => item.category === record.category).map((item) => <option key={item.id} value={item.id}>{item.content.name || item.content.company || item.content.school || "整段原文"} · {item.content.start || item.content.date || "日期未填"}</option>)}</select></label>}
            {record && matchingMemory && <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><input type="radio" name={`record-${row.id}`} checked={(recordPreference[key] || "version") === "version"} onChange={() => setRecordPreference((current) => ({ ...current, [key]: "version" }))} />另存一版，默认版不变</label>
              <label className="flex items-center gap-2"><input type="radio" name={`record-${row.id}`} checked={recordPreference[key] === "replace"} onChange={() => setRecordPreference((current) => ({ ...current, [key]: "replace" }))} />设为默认版</label>
            </div>}
            {record && !matchingMemory && <label className="flex gap-2"><input type="checkbox" checked={enableAutomatic[key] || false} onChange={(event) => setEnableAutomatic((current) => ({ ...current, [key]: event.target.checked }))} />以后一键填写时自动用它（不勾只在预览里可选）</label>}
          </div>
        )}
      </li>
    );
  }

  return (
    <section id="pending-application-changes" className="scroll-mt-6 space-y-3">
      <div>
        <h2 className="text-base font-semibold">待核对{rows.length ? <span className="ml-1.5 text-sm font-normal text-muted-foreground">{rows.length}</span> : null}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">你在网申里手写的回答和经历。记住后以后会自动填；不处理也没关系，两周后自动收起。</p>
      </div>
      {!rows.length ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed p-5 text-sm text-muted-foreground"><Inbox className="size-4" />没有要核对的内容。</div>
      ) : (
        [...groups.entries()].map(([key, list]) => {
          const label = sources[key] || sourceName(list[0].sourceUrl);
          const main = list.filter((row) => !isShortField(row));
          const fields = list.filter(isShortField);
          return (
            <article key={key} className="rounded-xl border bg-card p-4">
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{label}</p>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    {new Date(list[0].createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} · {list.length} 条
                    <a href={list[0].sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">打开网页<ExternalLink className="size-3" /></a>
                  </p>
                </div>
                <div className="flex gap-1">
                  {profileReady(list).length > 0 && <Button size="sm" variant="outline" disabled={!!busyId} onClick={() => acceptAllIntoProfile(profileReady(list))} title="网申资料里还空着的字段，用你在这里手填的内容补上"><Check className="size-3.5" />全部记进网申资料（{new Set(profileReady(list).map((row) => row.profileField!.key)).size}）</Button>}
                  <Button size="sm" variant="ghost" disabled={!!busyId} onClick={() => ignoreAll(list, label)}>全部忽略</Button>
                </div>
              </header>
              {!!main.length && <ul className="divide-y">{main.map(renderItem)}</ul>}
              {!!fields.length && (
                <details className={main.length ? "mt-3 border-t pt-3" : ""} open={!main.length}>
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">其他字段 {fields.length} 个（{fields.slice(0, 3).map((row) => row.label).join("、")}{fields.length > 3 ? "…" : ""}）</summary>
                  <ul className="mt-3 divide-y">{fields.map(renderItem)}</ul>
                </details>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}
