"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { applicationRulesSchema, type ApplicationRules } from "@/lib/application-rules";
import { getApplicationRules, saveApplicationRules, suggestApplicationRules } from "@/lib/actions/application-rules";
export function ApplicationRulesDialog({ positionId }: { positionId: string }) {
  const [open, setOpen] = useState(false); const [rules, setRules] = useState(applicationRulesSchema.parse({}));
  const [revision, setRevision] = useState(0); const [submitted, setSubmitted] = useState(0); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const [dirty, setDirty] = useState(false);
  function patch(value: Partial<ApplicationRules>) { setRules((r) => ({ ...r, ...value, verifiedAt: null })); setDirty(true); }
  return <Dialog open={open} onOpenChange={async (value) => { if (!value && dirty && !window.confirm("报名规则尚未保存，确定关闭？")) return; setOpen(value); if (value && !loaded) { setBusy(true); try { const r = await getApplicationRules(positionId); setRules(r.rules); setRevision(r.revision); setSubmitted(r.submitted); setLoaded(true); } catch (e) { toast.error(e instanceof Error ? e.message : "读取失败"); } finally { setBusy(false); } } }}><DialogTrigger render={<Button size="sm" variant="outline">报名规则</Button>} /><DialogContent initialFocus={false} className="max-h-[85dvh] overflow-auto sm:max-w-2xl"><DialogHeader><DialogTitle>报名资格、志愿与公告核验</DialogTitle></DialogHeader>
    <p className="text-xs text-muted-foreground">该公司历史已记录 {submitted} 次投递。不同招聘批次和撤回后的计数可能不同，请对照公告核实。</p>
    <Button size="sm" variant="outline" disabled={busy || !loaded} onClick={async () => { if (dirty && !window.confirm("提取草稿会替换当前未保存内容，继续？")) return; setBusy(true); const r = await suggestApplicationRules(positionId); setBusy(false); if (r.ok) { setRules(r.data); setDirty(true); } else toast.error(r.message); }}>从已保存岗位描述提取草稿</Button>
    {([ ["eligibility", "学历 / 专业 / 语言等资格"], ["graduationWindow", "毕业时间范围"], ["applicationGroup", "招聘批次 / 可投范围"], ["preferenceOrder", "志愿顺序与平行志愿规则"], ["editPolicy", "能否修改 / 修改次数"], ["deadlineNote", "截止日期原文"], ["sourceUrl", "公告原文链接"], ["entryUrl", "实际报名入口"] ] as const).map(([key, label]) => <label className="space-y-1 text-sm" key={key}>{label}<textarea disabled={!loaded || busy} className="w-full rounded border bg-background p-2" value={rules[key]} onChange={(e) => patch({ [key]: e.target.value })} /></label>)}
    <label className="text-sm">可投岗位数<input type="number" min="1" max="100" className="ml-2 w-24 rounded border bg-background p-1" value={rules.maxPositions ?? ""} onChange={(e) => patch({ maxPositions: e.target.value ? Number(e.target.value) : null })} />（空白表示待核实）</label>
    <label>截止方式<select className="ml-2 rounded border bg-background p-1" value={rules.recruitmentMode} onChange={(e) => patch({ recruitmentMode: e.target.value as ApplicationRules["recruitmentMode"] })}><option value="unknown">待核实</option><option value="fixed">明确截止</option><option value="rolling">滚动招聘</option></select></label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={!!rules.verifiedAt} onChange={(e) => { setRules((r) => ({ ...r, verifiedAt: e.target.checked ? new Date().toISOString() : null })); setDirty(true); }} />我已对照公告核验以上规则</label>
    <p className="text-xs text-muted-foreground">{rules.verifiedAt ? `最后核验：${new Date(rules.verifiedAt).toLocaleString("zh-CN")}` : "未核验，AI 提取内容只作为草稿。"}</p>
    <Button disabled={busy || !loaded || !dirty} onClick={async () => { setBusy(true); const r = await saveApplicationRules(positionId, revision, rules); setBusy(false); if (r.ok) { setRevision(r.data.revision); setDirty(false); toast.success("报名规则已保存"); } else toast.error(r.message); }}>保存规则</Button>
  </DialogContent></Dialog>;
}
