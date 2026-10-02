"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DesktopBridge, DesktopBridgeAutofillOptions, DesktopBridgeAutofillStatus, FillPlan } from "@/types/desktop-bridge";

type Job = { id: string; company: string; title: string; jd: string | null; url: string | null; submitted: number; rules: Record<string, unknown> | null };
function copyChoices(profile: Record<string, unknown>) {
  const choices: { label: string; value: string }[] = [];
  const labels: Record<string, string> = { name: "姓名", phone: "手机", email: "邮箱", gender: "性别", birthDate: "出生日期", currentCity: "现居地", selfIntro: "自我评价", targetRole: "期望岗位", politics: "政治面貌", hometown: "籍贯", english: "英语水平" };
  for (const [key, label] of Object.entries(labels)) if (typeof profile[key] === "string" && profile[key]) choices.push({ label, value: profile[key] as string });
  for (const [key, label] of [["education", "教育"], ["experiences", "工作/实习"], ["projects", "项目"]]) if (Array.isArray(profile[key])) (profile[key] as Record<string, string>[]).forEach((row, i) => {
    for (const [name, value] of Object.entries(row)) if (typeof value === "string" && value) choices.push({ label: `${label} ${i + 1} · ${name}`, value });
  });
  return choices;
}
export function ApplicationAssistant({ bridge, status, busy, resumeId, variantId, positionId, onPosition, onPreview, onApply }: {
  bridge: DesktopBridge; status: DesktopBridgeAutofillStatus | null; busy: boolean; resumeId: string; variantId: string; positionId: string;
  onPosition: (id: string) => void; onPreview: (extra?: DesktopBridgeAutofillOptions) => void; onApply: (options: DesktopBridgeAutofillOptions) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cards, setCards] = useState<{ label: string; value: string }[]>([]);
  const [length, setLength] = useState(200);
  const edits = useRef<NonNullable<DesktopBridgeAutofillOptions["previewEdits"]>>([]);
  const rememberEdits = useCallback((rows: NonNullable<DesktopBridgeAutofillOptions["previewEdits"]>) => { edits.current = rows; }, []);
  const [drafts, setDrafts] = useState<{ id: string; name: string; url: string; contextKey: string }[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/desktop-browser/application-draft", { signal: controller.signal }).then((r) => r.json()).then(setDrafts).catch(() => {});
    fetch("/api/desktop-browser/application-context", { signal: controller.signal }).then((r) => { if (!r.ok) throw new Error("岗位列表加载失败"); return r.json(); }).then((b) => setJobs(b.positions)).catch((e) => { if (e.name !== "AbortError") toast.error(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/desktop-browser/profile?${new URLSearchParams({ resumeVersionId: resumeId, variantId })}`, { signal: controller.signal }).then((r) => r.json()).then((p) => setCards(copyChoices(p))).catch(() => {});
    return () => controller.abort();
  }, [resumeId, variantId]);
  const job = jobs.find((j) => j.id === positionId);
  return <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-3 text-sm" aria-label="填写助手">
    <h2 className="font-semibold">填写助手</h2>
    {drafts.length > 0 && <details><summary>已保存填写草稿（未提交）</summary><ul className="mt-2 space-y-2">{drafts.map((d) => <li key={d.id} className="flex gap-2 text-xs"><button className="flex-1 truncate text-left underline" title={d.url} onClick={() => { if (d.contextKey.startsWith("job:v1:")) onPosition(d.contextKey.slice(7)); bridge.navigate(d.url); }}>{d.name} · {d.url}</button><button onClick={() => { if (window.confirm("删除这份填写草稿？")) fetch(`/api/desktop-browser/application-draft?id=${d.id}`, { method: "DELETE" }).then((r) => { if (r.ok) setDrafts((list) => list.filter((x) => x.id !== d.id)); }); }}>删除</button></li>)}</ul><p className="text-xs text-muted-foreground">打开原页面后扫描预览，可恢复同一简历和资料方案的草稿。</p></details>}
    <label className="space-y-1">当前申请岗位<select aria-label="当前申请岗位" disabled={busy} value={positionId} onChange={(e) => onPosition(e.target.value)} className="w-full rounded-md border bg-background p-2 text-xs"><option value="">未关联（通用填写）</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.company} · {j.title}</option>)}</select></label>
    <p className="text-xs text-muted-foreground">{job ? `正在申请 ${job.company} · ${job.title}${job.jd ? "，AI 将结合已保存招聘要求" : "；请在候选岗位补充招聘要求"}` : "关联岗位后，AI 可以结合公司和招聘要求作答。"}</p>
    {job?.rules && <p className="rounded border p-2 text-xs">报名规则：{String(job.rules.eligibility || "资格待核实")} · {job.rules.recruitmentMode === "rolling" ? "滚动招聘" : job.rules.recruitmentMode === "fixed" ? "明确截止" : "截止方式待核实"}{job.rules.maxPositions ? ` · 公告岗位上限 ${job.rules.maxPositions}，历史投递 ${job.submitted} 次（请核对批次）` : ""}{job.rules.verifiedAt ? ` · 上次核验 ${String(job.rules.verifiedAt).slice(0, 10)}` : " · 尚未核验"}</p>}
    <label className="text-xs">开放题目标长度<select value={length} onChange={(e) => setLength(Number(e.target.value))} className="ml-2 rounded border bg-background p-1">{[100, 200, 300, 500].map((n) => <option key={n} value={n}>{n} 字</option>)}</select></label>
    <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => onPreview({ answerLength: length, previewEdits: status?.plan ? edits.current : [] })}>扫描并预览</Button><Button size="sm" variant="outline" disabled={busy || !resumeId} onClick={() => onPreview({ regenerate: true, answerLength: length, previewEdits: status?.plan ? edits.current : [] })}>重写未填回答</Button></div>
    {status?.plan && <PlanEditor key={status.plan.id} plan={status.plan} busy={busy} bridge={bridge} onApply={onApply} onRows={rememberEdits} onQuestion={(id, rows) => onPreview({ regenerate: true, answerLength: length, questionIds: [id], previewEdits: rows })} />}
    {status?.details && <details open><summary>待处理字段</summary><ul className="space-y-1 pt-2">{status.details.filter((d) => d.source === "manual").map((d, i) => <li key={i}><button className="text-left text-xs underline" onClick={() => d.id && bridge.focusField(d.id)}>{d.label}：{d.state}</button></li>)}</ul></details>}
    <details><summary>资料卡 · 点击复制</summary><div className="mt-2 space-y-2">{cards.map((c, i) => <button key={i} className="block w-full rounded border p-2 text-left text-xs" onClick={() => navigator.clipboard.writeText(c.value).then(() => toast.success("已复制")).catch(() => toast.error("复制失败"))}><strong>{c.label}</strong><p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{c.value}</p></button>)}</div></details>
    <p className="text-xs text-muted-foreground">网页不支持自动填时，可以从资料卡复制。已有内容和手动修改会保留。</p>
  </aside>;
}
function PlanEditor({ plan, busy, bridge, onApply, onQuestion, onRows }: { plan: FillPlan; busy: boolean; bridge: DesktopBridge; onApply: (options: DesktopBridgeAutofillOptions) => void; onQuestion: (id: string, rows: NonNullable<DesktopBridgeAutofillOptions["previewEdits"]>) => void; onRows: (rows: NonNullable<DesktopBridgeAutofillOptions["previewEdits"]>) => void }) {
  const [rows, setRows] = useState(plan.proposals.map((p) => ({ ...p, remember: p.remember || false })));
  useEffect(() => { onRows(rows); }, [rows, onRows]);
  const [upload, setUpload] = useState(plan.uploadResume);
  const [saveState, setSaveState] = useState("准备保存草稿…");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { fetch("/api/desktop-browser/application-draft", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contextKey: plan.contextKey, url: plan.url, positionId: plan.positionId, resumeVersionId: plan.resumeVersionId, variantId: plan.variantId, fields: rows.filter((r) => r.eligible).map(({ label, fieldKey, section, value, ref, selected, remember, edited }) => ({ label, fieldKey, section, value, ref, selected, remember, edited })) }) }).then((r) => { if (!r.ok) throw new Error(); setSaveState("填写草稿已保存在 App，尚未提交"); }).catch((e) => { if (e.name !== "AbortError") setSaveState("草稿保存失败，请保留当前内容并重试"); }); }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [rows, plan]);
  const patch = (id: string, value: Partial<typeof rows[number]>) => setRows((items) => items.map((p) => p.id === id ? { ...p, ...value, edited: true } : p));
  return <div className="space-y-2"><h3 className="font-medium">填写前预览</h3><p className="text-xs text-muted-foreground">{saveState}</p><p className="text-xs text-muted-foreground">AI 草稿默认不勾选。可以指定某组字段使用哪段教育或工作资料。</p>
    {rows.map((p) => <fieldset key={p.id} disabled={busy || !p.eligible} className="space-y-1 rounded border p-2 text-xs disabled:opacity-60">
      <label className="flex gap-2"><input type="checkbox" checked={p.selected} onChange={(e) => patch(p.id, { selected: e.target.checked })} /><span>{p.section ? `${p.section} · ` : ""}{p.label}{p.required ? " *" : ""}</span></label>
      <button type="button" className="underline" onClick={() => bridge.focusField(p.id)}>定位网页字段</button>
      <p className="text-muted-foreground">{p.note}{p.maxLength ? ` · 上限 ${p.maxLength} 字` : ""}</p>
      {p.eligible && <><select aria-label={`${p.label}对应资料`} className="w-full rounded border bg-background p-1" value={p.ref} onChange={(e) => { const c = plan.choices.find((x) => x.ref === e.target.value); patch(p.id, { ref: e.target.value, value: c?.value || p.value, selected: true }); }}><option value="">手动编辑 / 原建议</option>{plan.choices.map((c) => <option key={c.ref} value={c.ref}>{c.label}</option>)}</select>
      <textarea aria-label={`${p.label}建议值`} className="min-h-16 w-full rounded border bg-background p-1" value={p.value} onChange={(e) => patch(p.id, { value: e.target.value, ref: "" })} />
      {p.maxLength && p.value.length > p.maxLength && <p className="text-destructive">超过上限 {p.value.length - p.maxLength} 字</p>}
      {p.ref && <label><input type="checkbox" checked={p.remember} onChange={(e) => patch(p.id, { remember: e.target.checked })} /> 记住该字段对应资料</label>}
      {p.source === "ai" && <button type="button" className="underline" onClick={() => onQuestion(p.id, rows)}>只重写这道题</button>}</>}
    </fieldset>)}
    {plan.uploadResume && <label className="flex gap-2 text-xs"><input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} />上传所选简历附件</label>}
    <Button size="sm" disabled={busy || rows.some((p) => p.selected && p.maxLength && p.value.length > p.maxLength) || (!upload && !rows.some((p) => p.selected && p.value))} onClick={() => onApply({ mode: "apply", planId: plan.id, approved: rows.filter((p) => p.selected && p.eligible).map(({ id, value, ref, remember }) => ({ id, value, ref, remember })), uploadResume: upload })}>确认填写所选字段</Button>
  </div>;
}
