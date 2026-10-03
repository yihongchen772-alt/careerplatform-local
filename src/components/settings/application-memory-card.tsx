"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { updateApplicationMemory, deleteApplicationMemory, mergeApplicationMemories } from "@/lib/actions/application-memory";
import { MEMORY_CATEGORIES, type MemoryView, type MemoryContent } from "@/lib/application-memory";
import { cn } from "@/lib/utils";

const columns: Record<string, string> = { name: "名称", company: "公司 / 单位", school: "学校", role: "职位 / 角色", major: "专业", degree: "学历", gpa: "GPA", start: "开始时间", end: "结束时间", date: "获奖时间", issuer: "颁发单位", level: "奖项等级", description: "描述 / 成果", responsibilities: "个人职责与成果", text: "整段原文" };
const memoryTitle = (row: MemoryView) => row.content.name || row.content.company || row.content.school || `${MEMORY_CATEGORIES[row.category]}（整段原文）`;
type Draft = { content: MemoryContent; enabled: boolean };

export function ApplicationMemoryCard({ initial }: { initial: MemoryView[] }) {
  const [rows, setRows] = useState(initial);
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initial[0]?.id ?? "");
  // Drafts stay with their record when the user switches categories/rows.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const selected = rows.find((row) => row.id === selectedId);
  const draft = selected ? drafts[selected.id] ?? { content: selected.content, enabled: selected.enabled } : null;
  const filtered = rows.filter((row) => (category === "all" || row.category === category) && Object.values(row.content).join(" ").toLowerCase().includes(query.toLowerCase()));
  const patch = (changes: Partial<Draft>) => { if (selected && draft) setDrafts((current) => ({ ...current, [selected.id]: { ...draft, ...changes } })); };

  async function save() {
    if (!selected || !draft || busy) return;
    setBusy(true);
    try {
      const res = await updateApplicationMemory(selected.id, selected.revision, draft);
      if (!res.ok) return void toast.error(res.message);
      setRows((current) => current.map((row) => row.id === res.data.id ? res.data : row));
      setDrafts((current) => { const next = { ...current }; delete next[selected.id]; return next; });
      toast.success("已保存，下次按所选版本填写");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!selected) return;
    const res = await deleteApplicationMemory(selected.id, selected.revision);
    if (!res.ok) return void toast.error(res.message);
    setRows((current) => current.filter((row) => row.id !== selected.id));
    setChecked((current) => current.filter((id) => id !== selected.id)); setSelectedId("");
    toast.success("已删除经历记忆");
  }

  async function merge() {
    if (busy) return;
    if (checked.some((id) => drafts[id])) return void toast.error("请先保存所选记录的修改，再合并");
    setBusy(true);
    try {
      const res = await mergeApplicationMemories(checked.map((id) => ({ id, revision: rows.find((row) => row.id === id)!.revision })));
      if (!res.ok) return void toast.error(res.message);
      setRows((current) => [res.data, ...current.filter((row) => !checked.includes(row.id))]);
      setSelectedId(res.data.id); setChecked([]); toast.success("已合并，差异描述保留为可选版本");
    } finally { setBusy(false); }
  }

  return <Card id="experience-memory" className="md:col-span-2 scroll-mt-6">
    <CardHeader>
      <CardTitle>经历记忆库</CardTitle>
      <p className="text-sm text-muted-foreground">手填的项目、实习、教育和获奖按整条记住，可在其他官网复用。重复记录自动合并，每条最多保留 5 个其他版本；网申资料里手动维护的内容优先。</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="经历类型">
        {[["all", "全部"], ...Object.entries(MEMORY_CATEGORIES)].map(([value, label]) => <Button key={value} size="sm" variant={category === value ? "secondary" : "ghost"} onClick={() => {
          setCategory(value); setChecked([]);
          if (selected && value !== "all" && selected.category !== value) setSelectedId(rows.find((row) => row.category === value && Object.values(row.content).join(" ").toLowerCase().includes(query.toLowerCase()))?.id || "");
          else if (!selected) setSelectedId(rows.find((row) => (value === "all" || row.category === value) && Object.values(row.content).join(" ").toLowerCase().includes(query.toLowerCase()))?.id || "");
        }}>{label} {rows.filter((row) => value === "all" || row.category === value).length}</Button>)}
      </div>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、公司或奖项" aria-label="搜索经历记忆" />
      {!rows.length ? <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">在网申浏览器手填一段经历，离开输入框后会自动记住。也可以点击「记住本页经历」收录当前页面。密码、证件号和未修改的 AI 草稿不会收录。</p> : <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div className="max-h-[32rem] space-y-2 overflow-y-auto">
            {filtered.map((row) => <div key={row.id} className={cn("flex items-start gap-2 rounded-xl border p-3", selectedId === row.id && "border-primary/50 bg-primary/5")}>
              <input type="checkbox" className="mt-1" aria-label={`合并选择 ${memoryTitle(row)}`} checked={checked.includes(row.id)} onChange={(event) => setChecked((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(row.id)}>
                <span className="block truncate text-sm font-medium">{memoryTitle(row)}</span>
                <span className="block truncate text-xs text-muted-foreground">{[MEMORY_CATEGORIES[row.category], row.content.role || row.content.level || row.content.degree, row.content.start || row.content.date].filter(Boolean).join(" · ")}</span>
                <span className="mt-2 block text-xs text-muted-foreground">{row.enabled ? "可用于填充" : "已暂停复用"}{row.alternatives.length ? ` · ${row.alternatives.length} 个其他版本` : ""}{drafts[row.id] ? " · 未保存" : ""}</span>
              </button>
            </div>)}
            {!filtered.length && <p className="p-5 text-sm text-muted-foreground">没有匹配的经历</p>}
          </div>
          <Button size="sm" variant="outline" disabled={checked.length < 2 || busy} onClick={merge}>合并所选 {checked.length > 0 ? `（${checked.length}）` : ""}</Button>
          <p className="text-xs text-muted-foreground">合并时以先勾选的记录为主；有差异的内容保留为版本。</p>
        </div>
        {selected && draft && <div className="space-y-4 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{MEMORY_CATEGORIES[selected.category]}</span>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />用于填充</label>
          </div>
          {!!selected.alternatives.length && <details className="rounded-lg bg-muted/50 p-3">
            <summary className="cursor-pointer text-sm">其他版本（{selected.alternatives.length}）</summary>
            {selected.alternatives.map((version, i) => <div key={i} className="mt-3 space-y-2 border-t pt-3">
              <p className="break-words text-xs text-muted-foreground">{version.source}</p>
              <p className="whitespace-pre-wrap text-sm">{Object.entries(version.content).filter(([, value]) => value).map(([key, value]) => `${columns[key] || key}：${value}`).join("\n")}</p>
              <Button size="sm" variant="outline" onClick={() => patch({ content: { ...version.content } })}>使用这个版本</Button>
            </div>)}
          </details>}
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(draft.content).map(([key, value]) => <label key={key} className={cn("space-y-1 text-xs text-muted-foreground", /description|responsibilities|^text$/.test(key) && "sm:col-span-2")}>
              <span>{columns[key] || key}</span>
              {/description|responsibilities|^text$/.test(key) ? <Textarea aria-label={columns[key] || key} rows={key === "text" ? 8 : 4} value={value} onChange={(event) => patch({ content: { ...draft.content, [key]: event.target.value } })} /> : <Input aria-label={columns[key] || key} value={value} onChange={(event) => patch({ content: { ...draft.content, [key]: event.target.value } })} />}
            </label>)}
          </div>
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">来自 {selected.sources.length} 个页面</summary><div className="mt-2 space-y-1">{selected.sources.map((source, i) => <p key={i} className="break-all">{source.url}</p>)}</div></details>
          <div className="flex justify-between gap-2 border-t pt-3">
            <ConfirmDeleteButton trigger={<Button variant="ghost" size="sm" className="text-destructive" disabled={busy}>删除</Button>} title="删除这条经历记忆？" description="删除后不再从记忆库复用。网申资料中手动维护的记录仍由网申资料管理。" onConfirm={remove} />
            <Button size="sm" disabled={busy || !drafts[selected.id]} onClick={save}>{busy ? "保存中…" : "保存修改"}</Button>
          </div>
        </div>}
      </div>}
    </CardContent>
  </Card>;
}
