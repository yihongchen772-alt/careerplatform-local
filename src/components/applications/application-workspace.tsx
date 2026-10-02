"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { communicationDraft, stageChecklist, type WorkflowItem } from "@/lib/application-workflow";
import { saveApplicationWorkflow } from "@/lib/actions/application-workflow";
import type { SubmissionPackage } from "@/lib/submission-package";
export function ApplicationWorkspace({ id, company, title, stage, revision: initialRevision, checklist, material, attachments }: {
  id: string; company: string; title: string; stage: string; revision: number; checklist: Record<string, WorkflowItem[]> | null; material: SubmissionPackage | null; attachments: { id: string; url: string; name: string }[];
}) {
  const [items, setItems] = useState(checklist?.[stage] || stageChecklist(stage));
  const [revision, setRevision] = useState(initialRevision);
  const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  const [kind, setKind] = useState("followup"); const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = drafts[kind] ?? communicationDraft(kind, company, title);
  function edit(index: number, patch: Partial<WorkflowItem>) { setItems((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item)); setDirty(true); }
  const attachment = attachments.find((a) => a.id === material?.resumeAttachmentId);
  return <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>本阶段下一步</CardTitle></CardHeader><CardContent className="space-y-3">
    {items.map((item, i) => <div key={item.id} className="flex flex-wrap items-center gap-2"><input aria-label={`完成 ${item.title}`} type="checkbox" checked={item.done} onChange={(e) => edit(i, { done: e.target.checked })} /><input aria-label="清单内容" className="min-w-40 flex-1 rounded border bg-background p-1 text-sm" value={item.title} onChange={(e) => edit(i, { title: e.target.value })} /><input aria-label={`${item.title}截止日期`} type="date" className="rounded border bg-background p-1 text-xs" value={item.dueDate?.slice(0, 10) || ""} onChange={(e) => edit(i, { dueDate: e.target.value })} /></div>)}
    <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { setItems((items) => [...items, { id: crypto.randomUUID(), title: "新增任务", done: false }]); setDirty(true); }}>添加任务</Button><Button size="sm" disabled={busy || !dirty} onClick={async () => { setBusy(true); const r = await saveApplicationWorkflow({ applicationId: id, stage, revision, items }); setBusy(false); if (!r.ok) toast.error(r.message); else { setItems(r.data.items); setRevision(r.data.revision); setDirty(false); toast.success("清单已保存，有日期的任务已加入提醒"); } }}>保存清单{dirty ? "（未保存）" : ""}</Button></div>
    <p className="text-xs text-muted-foreground">日期由你决定；保存后复用现有日历、系统和邮件提醒。</p>
    <details><summary className="text-sm">沟通邮件草稿</summary><div className="mt-2 space-y-2"><select className="rounded border bg-background p-1 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}><option value="followup">进度跟进</option>{/INTERVIEW|OFFER|ACCEPTED/.test(stage) && <option value="thanks">面试感谢</option>}<option value="withdraw">撤回申请</option></select><textarea aria-label="沟通草稿" className="min-h-52 w-full rounded border bg-background p-2 text-sm" value={draft} onChange={(e) => setDrafts((saved) => ({ ...saved, [kind]: e.target.value }))} /><Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(draft).then(() => toast.success("已复制，请补齐占位内容后发送"))}>复制草稿</Button></div></details>
  </CardContent></Card><Card><CardHeader><CardTitle>本次投递材料包</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">{material ? <>
    <p>确认记录时间：{new Date(material.confirmedAt).toLocaleString("zh-CN")}</p><p>资料方案：{material.variant} · 简历：{material.resumeName}</p>
    {attachment && <a href={attachment.url} download className="text-primary underline">下载投递时简历副本</a>}
    <p className="text-xs text-muted-foreground">归档内容记录当时状态，之后修改简历和资料不会覆盖。网页不可读取或已离开的字段可能未收录。</p>
    <details><summary>最终填写内容（{material.fields.length} 项）</summary><dl className="mt-2 max-h-80 space-y-3 overflow-auto">{material.fields.map((f, i) => <div key={i}><dt className="font-medium">{f.label}</dt><dd className="whitespace-pre-wrap text-muted-foreground">{f.value}</dd></div>)}</dl></details>
    <details><summary>当时的招聘要求</summary><p className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap">{material.jd || "未保存招聘要求"}</p></details>
    <details><summary>当时的资料方案</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(material.profile, null, 2)}</pre></details>
  </> : <p className="text-muted-foreground">这条历史记录没有材料包。今后从网申浏览器或插件确认「记为已投递」时，可以保存本次材料。</p>}</CardContent></Card></div>;
}
