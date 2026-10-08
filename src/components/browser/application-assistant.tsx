"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCopy, Crosshair, FileText, ListChecks, ScanSearch, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DesktopBridge, DesktopBridgeAutofillOptions, DesktopBridgeAutofillStatus, DesktopBridgeFillSource, FillPlan } from "@/types/desktop-bridge";

export type AssistantTab = "preview" | "result" | "cards" | "settings";

type Job = { id: string; company: string; title: string; jd: string | null; url: string | null; submitted: number; rules: Record<string, unknown> | null };

// Native controls on purpose: their pop-ups are drawn by the OS above the
// web page, which App-drawn menus can't be while the page is showing.
export const panelSelect = "h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60";
const panelText = "w-full rounded-md border bg-background p-2 text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

// Same colours as the outlines fillFields draws on the page, so a dot here
// and a border there mean the same thing.
const FILL_SOURCES: { source: DesktopBridgeFillSource; label: string; dot: string }[] = [
  { source: "manual", label: "需要你手填", dot: "bg-red-500" },
  { source: "ai", label: "AI 生成（紫红框）", dot: "bg-fuchsia-500" },
  { source: "memory", label: "记忆库 / 你的回答（绿框）", dot: "bg-green-600" },
  { source: "profile", label: "网申资料（紫框）", dot: "bg-violet-500" },
  { source: "prefilled", label: "页面原有内容", dot: "bg-muted-foreground/40" },
  { source: "excluded", label: "未选择的模块", dot: "bg-muted-foreground/40" },
];

function copyChoices(profile: Record<string, unknown>) {
  const choices: { label: string; value: string }[] = [];
  const labels: Record<string, string> = { name: "姓名", phone: "手机", email: "邮箱", gender: "性别", birthDate: "出生日期", currentCity: "现居地", selfIntro: "自我评价", targetRole: "期望岗位", politics: "政治面貌", hometown: "籍贯", ethnicity: "民族", english: "英语水平", expectedSalary: "期望薪资", availableFrom: "最早到岗时间", internshipDuration: "可实习时长", wechat: "微信号", address: "通讯地址" };
  for (const [key, label] of Object.entries(labels)) if (typeof profile[key] === "string" && profile[key]) choices.push({ label, value: profile[key] as string });
  const columns: Record<string, string> = { school: "学校", company: "公司", name: "名称", role: "职位 / 角色", start: "开始", end: "结束", major: "专业", degree: "学历", description: "描述", responsibilities: "职责与成果", issuer: "颁发单位", level: "等级", date: "获奖时间" };
  for (const [key, label] of [["education", "教育"], ["experiences", "工作/实习"], ["projects", "项目"], ["awards", "获奖"]]) if (Array.isArray(profile[key])) (profile[key] as Record<string, string>[]).forEach((row, i) => {
    for (const [name, value] of Object.entries(row)) if (typeof value === "string" && value) choices.push({ label: `${label} ${i + 1} · ${columns[name] || name}`, value });
  });
  return choices;
}

const TABS: { id: AssistantTab; label: string; icon: typeof ScanSearch }[] = [
  { id: "preview", label: "预览", icon: ScanSearch },
  { id: "result", label: "结果", icon: ListChecks },
  { id: "cards", label: "资料卡", icon: ClipboardCopy },
  { id: "settings", label: "设置", icon: Settings2 },
];

/**
 * The browser's side panel (Chrome's 侧边栏): previewing a fill field by
 * field, checking the last result and jumping to what still needs typing,
 * copying profile facts by hand, and the fill settings. It sits beside the
 * page, so the page stays visible and clickable while it is open.
 */
export function ApplicationAssistant({ bridge, status, busy, hasPage, resumeId, variantId, positionId, tab, onTab, onClose, onPosition, onPreview, onApply, settings, onOpenProfile }: {
  bridge: DesktopBridge; status: DesktopBridgeAutofillStatus | null; busy: boolean; hasPage: boolean; resumeId: string; variantId: string; positionId: string;
  tab: AssistantTab; onTab: (tab: AssistantTab) => void; onClose: () => void;
  onPosition: (id: string) => void; onPreview: (extra?: DesktopBridgeAutofillOptions) => void; onApply: (options: DesktopBridgeAutofillOptions) => void;
  settings: React.ReactNode; onOpenProfile: () => void;
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
  const manual = status?.details?.filter((d) => d.source === "manual") ?? [];

  return <aside className="flex w-[21rem] shrink-0 flex-col border-l bg-card text-sm" aria-label="填写助手">
    <div className="shrink-0 border-b">
      <div className="flex h-10 items-center gap-2 pr-1.5 pl-3">
        <span className="font-medium">填写助手</span>
        <button type="button" aria-label="关闭填写助手" title="关闭侧边栏" onClick={onClose} className="ml-auto grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
      </div>
      <div role="tablist" aria-label="填写助手页签" className="mx-3 mb-2.5 grid grid-cols-4 rounded-lg bg-muted p-0.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)} className={cn("flex h-7 items-center justify-center gap-1 rounded-md text-xs whitespace-nowrap transition-colors", tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="size-3.5" />
            {label}
            {id === "result" && manual.length > 0 && <span className="rounded-full bg-red-500/15 px-1 text-[10px] leading-4 text-red-600">{manual.length}</span>}
          </button>
        ))}
      </div>
    </div>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {tab === "preview" && <>
        <label className="block space-y-1 text-xs">
          <span className="font-medium">当前申请岗位</span>
          <select aria-label="当前申请岗位" disabled={busy} value={positionId} onChange={(e) => onPosition(e.target.value)} className={panelSelect}><option value="">未关联（通用填写）</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.company} · {j.title}</option>)}</select>
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">{job ? `正在申请 ${job.company} · ${job.title}${job.jd ? "，AI 会结合已保存的招聘要求作答" : "；在候选岗位里补充招聘要求后，AI 回答会更贴合"}` : "关联岗位后，AI 可以结合公司和招聘要求回答开放题。"}</p>
        {job?.rules && <p className="rounded-md bg-muted/60 p-2 text-xs leading-relaxed">报名规则：{String(job.rules.eligibility || "资格待核实")} · {job.rules.recruitmentMode === "rolling" ? "滚动招聘" : job.rules.recruitmentMode === "fixed" ? "明确截止" : "截止方式待核实"}{job.rules.maxPositions ? ` · 公告岗位上限 ${job.rules.maxPositions}，历史投递 ${job.submitted} 次（请核对批次）` : ""}{job.rules.verifiedAt ? ` · 上次核验 ${String(job.rules.verifiedAt).slice(0, 10)}` : " · 尚未核验"}</p>}
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium">开放题目标长度</span>
          <select value={length} onChange={(e) => setLength(Number(e.target.value))} className={cn(panelSelect, "w-24")}>{[100, 200, 300, 500].map((n) => <option key={n} value={n}>{n} 字</option>)}</select>
        </label>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !hasPage} title={hasPage ? undefined : "先打开网申页面"} onClick={() => onPreview({ answerLength: length, previewEdits: status?.plan ? edits.current : [] })}><ScanSearch />扫描并预览</Button>
          <Button size="sm" variant="outline" disabled={busy || !hasPage || !resumeId} title={!hasPage ? "先打开网申页面" : resumeId ? "重新生成还没填写的 AI 回答" : "先在设置里选择简历"} onClick={() => onPreview({ regenerate: true, answerLength: length, previewEdits: status?.plan ? edits.current : [] })}>重写未填回答</Button>
        </div>
        {status?.plan ? (
          <PlanEditor key={status.plan.id} plan={status.plan} busy={busy} bridge={bridge} onApply={onApply} onRows={rememberEdits} onQuestion={(id, rows) => onPreview({ regenerate: true, answerLength: length, questionIds: [id], previewEdits: rows })} />
        ) : (
          <p className="rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">「扫描并预览」先列出每个字段准备填的内容，网页不会改动；核对、修改、勾选后再「确认填写所选字段」。AI 草稿默认不勾选。</p>
        )}
        {drafts.length > 0 && <details className="rounded-md border p-2 text-xs">
          <summary className="cursor-pointer font-medium">已保存的填写草稿（未提交，{drafts.length}）</summary>
          <ul className="mt-2 space-y-1.5">{drafts.map((d) => <li key={d.id} className="flex items-center gap-2"><button type="button" className="min-w-0 flex-1 truncate text-left text-primary hover:underline" title={d.url} onClick={() => { if (d.contextKey.startsWith("job:v1:")) onPosition(d.contextKey.slice(7)); void bridge.navigate(d.url); }}>{d.name} · {d.url}</button><button type="button" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm("删除这份填写草稿？")) fetch(`/api/desktop-browser/application-draft?id=${d.id}`, { method: "DELETE" }).then((r) => { if (r.ok) setDrafts((list) => list.filter((x) => x.id !== d.id)); }); }}>删除</button></li>)}</ul>
          <p className="mt-2 text-muted-foreground">打开原页面后「扫描并预览」，会恢复同一简历和资料方案下的草稿。</p>
        </details>}
      </>}

      {tab === "result" && (status?.details?.length ? <FillResult status={status} bridge={bridge} onOpenProfile={onOpenProfile} /> : (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
          <FileText className="size-8 opacity-40" />
          填写完成后，这里会逐项列出每个字段的来源，以及还需要你手填的项目；点一下就能在网页上定位。
        </div>
      ))}

      {tab === "cards" && <>
        <p className="text-xs text-muted-foreground">网页不支持自动填时，点一下复制，再粘贴到网页里。</p>
        <div className="space-y-1.5">{cards.map((c, i) => <button key={i} type="button" className="block w-full rounded-md border p-2 text-left text-xs transition-colors hover:bg-muted" onClick={() => navigator.clipboard.writeText(c.value).then(() => toast.success(`已复制「${c.label}」`)).catch(() => toast.error("复制失败"))}><span className="font-medium">{c.label}</span><p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-muted-foreground">{c.value}</p></button>)}</div>
        {cards.length === 0 && <p className="text-xs text-muted-foreground">还没有网申资料。<button type="button" className="text-primary hover:underline" onClick={onOpenProfile}>去账号设置填写</button></p>}
      </>}

      {tab === "settings" && settings}
    </div>
  </aside>;
}

function FillResult({ status, bridge, onOpenProfile }: { status: DesktopBridgeAutofillStatus; bridge: DesktopBridge; onOpenProfile: () => void }) {
  const details = status.details ?? [];
  const manual = details.filter((item) => item.source === "manual");
  const [onlyManual, setOnlyManual] = useState(manual.length > 0);
  const visible = onlyManual ? manual : details;
  return <div className="space-y-3 text-xs">
    {status.summary && <div className="grid grid-cols-3 gap-1.5 text-center">
      <div className="rounded-md bg-violet-500/10 py-2"><p className="text-base font-semibold">{status.summary.filled}</p><p className="text-muted-foreground">已填</p></div>
      <div className="rounded-md bg-muted py-2"><p className="text-base font-semibold">{status.summary.preserved}</p><p className="text-muted-foreground">保留原有</p></div>
      <div className={cn("rounded-md py-2", status.summary.manual ? "bg-red-500/10" : "bg-muted")}><p className="text-base font-semibold">{status.summary.manual}</p><p className="text-muted-foreground">待手填</p></div>
    </div>}
    <ul className="list-disc space-y-0.5 pl-4 leading-relaxed text-muted-foreground">
      {status.message.split("；").filter(Boolean).map((line, index) => <li key={index}>{line}</li>)}
    </ul>
    <div className="flex items-center gap-2">
      <Button size="xs" variant={onlyManual ? "default" : "outline"} onClick={() => setOnlyManual(!onlyManual)}>{onlyManual ? "显示全部字段" : `只看待手填（${manual.length}）`}</Button>
      <Button size="xs" variant="ghost" onClick={onOpenProfile}>补充网申资料</Button>
    </div>
    {FILL_SOURCES.map(({ source, label, dot }) => {
      const rows = visible.filter((item) => (item.source ?? "profile") === source);
      if (!rows.length) return null;
      return <div key={source} className="space-y-1">
        <p className="flex items-center gap-1.5 font-medium"><span className={`inline-block size-2 rounded-full ${dot}`} />{label}（{rows.length}）</p>
        <ul className="space-y-0.5">{rows.map((item, index) => <li key={`${item.label}-${index}`}>
          <button type="button" disabled={!item.id} onClick={() => item.id && void bridge.focusField(item.id)} title={item.id ? "在网页上定位这个字段" : undefined} className="group flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted disabled:hover:bg-transparent">
            <span className="min-w-0 flex-1"><span className="text-foreground">{item.label}</span><span className="text-muted-foreground"> · {item.state}</span></span>
            {item.id && <Crosshair className="mt-0.5 size-3 shrink-0 opacity-0 group-hover:opacity-60" />}
          </button>
        </li>)}</ul>
      </div>;
    })}
  </div>;
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
  const selectedCount = rows.filter((p) => p.selected && p.eligible).length;
  return <div className="space-y-2">
    <div className="flex items-baseline justify-between gap-2"><h3 className="text-xs font-medium">填写前预览</h3><span className="text-[11px] text-muted-foreground">{saveState}</span></div>
    <p className="text-xs text-muted-foreground">先整段选择经历，再核对字段。AI 草稿需要自行勾选。</p>
    {plan.blocks?.filter((block) => block.fieldIds.some((id) => rows.some((row) => row.id === id && row.eligible))).map((block) => <div key={block.id} className="space-y-1 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
      <label className="block font-medium">{block.label}<select aria-label={`${block.label}整段来源`} disabled={busy || !block.choices.length} className={cn(panelSelect, "mt-1")} value={block.choices.find((choice) => {
        const sources = rows.filter((row) => block.fieldIds.includes(row.id) && row.eligible && row.ref);
        return sources.length > 0 && sources.every((row) => row.ref === choice.ref || row.ref.startsWith(choice.ref + ":"));
      })?.ref || ""} onChange={(event) => {
        const choice = block.choices.find((item) => item.ref === event.target.value); if (!choice) return;
        setRows((current) => current.map((row) => block.fieldIds.includes(row.id) && row.eligible ? { ...row, value: choice.values[row.id]?.value || "", ref: choice.values[row.id]?.ref || "", selected: !!choice.values[row.id]?.value, remember: true, edited: true } : row));
      }}><option value="">保持原建议 / 手动填写</option>{block.choices.map((choice) => <option key={choice.ref} value={choice.ref}>{choice.label}</option>)}</select></label>
      <p className="text-muted-foreground">{block.note}。选择后会记住本页整段对应关系。</p>
    </div>)}
    {rows.map((p) => <fieldset key={p.id} disabled={busy || !p.eligible} className={cn("space-y-1.5 rounded-md border p-2 text-xs disabled:opacity-60", p.selected && p.eligible && "border-primary/40 bg-primary/[0.03]")}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" aria-label={`填写${p.label}`} checked={p.selected} onChange={(e) => patch(p.id, { selected: e.target.checked })} />
        <span className="min-w-0 flex-1 font-medium">{p.section ? <span className="font-normal text-muted-foreground">{p.section} · </span> : null}{p.label}{p.required ? <span className="text-destructive"> *</span> : ""}</span>
        <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" title="在网页上定位这个字段" onClick={() => bridge.focusField(p.id)}><Crosshair className="size-3.5" /></button>
      </div>
      <p className="text-muted-foreground">{p.note}{p.maxLength ? ` · 上限 ${p.maxLength} 字` : ""}</p>
      {p.eligible && <><select aria-label={`${p.label}对应资料`} className={panelSelect} value={p.ref} onChange={(e) => { const c = plan.choices.find((x) => x.ref === e.target.value); patch(p.id, { ref: e.target.value, value: c?.value || p.value, selected: true }); }}><option value="">手动编辑 / 原建议</option>{plan.choices.map((c) => <option key={c.ref} value={c.ref}>{c.label}</option>)}</select>
      <textarea aria-label={`${p.label}建议值`} className={cn(panelText, "min-h-16")} value={p.value} onChange={(e) => patch(p.id, { value: e.target.value, ref: "" })} />
      {p.maxLength && p.value.length > p.maxLength && <p className="text-destructive">超过上限 {p.value.length - p.maxLength} 字</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {p.ref && <label className="flex items-center gap-1"><input type="checkbox" checked={p.remember} onChange={(e) => patch(p.id, { remember: e.target.checked })} />记住该字段对应资料</label>}
        {p.source === "ai" && <button type="button" className="text-primary hover:underline" onClick={() => onQuestion(p.id, rows)}>只重写这道题</button>}
      </div></>}
    </fieldset>)}
    <div className="sticky bottom-0 -mx-3 space-y-2 border-t bg-card/95 px-3 pt-2 pb-1 backdrop-blur">
      {plan.uploadResume && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} />上传所选简历附件</label>}
      <Button size="sm" className="w-full" disabled={busy || rows.some((p) => p.selected && p.maxLength && p.value.length > p.maxLength) || (!upload && !rows.some((p) => p.selected && p.value))} onClick={() => onApply({ mode: "apply", planId: plan.id, approved: rows.filter((p) => p.selected && p.eligible).map(({ id, value, ref, remember }) => ({ id, value, ref, remember })), uploadResume: upload })}>确认填写所选字段（{selectedCount}）</Button>
    </div>
  </div>;
}
