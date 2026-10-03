"use client";

import { useState } from "react";
import { Check, Clock3, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptPendingApplicationChange, ignorePendingApplicationChange } from "@/lib/actions/pending-application-change";
import { MEMORY_CATEGORIES, sameMemoryEntity, type MemoryCapture, type MemoryView } from "@/lib/application-memory";
import type { PendingAnswer, PendingApplicationChangeView } from "@/lib/pending-application-change";

const contentLabels: Record<string, string> = { name: "名称", company: "公司 / 单位", school: "学校", role: "职位 / 角色", major: "专业", degree: "学历", gpa: "GPA", start: "开始时间", end: "结束时间", date: "时间", issuer: "颁发单位", level: "等级", description: "描述 / 成果", responsibilities: "职责与成果", text: "整段原文" };

function sourceName(url: string) {
  try { return new URL(url).hostname; } catch { return "网申页面"; }
}

export function PendingApplicationChangesCard({ initial, currentMemories }: { initial: PendingApplicationChangeView[]; currentMemories: MemoryView[] }) {
  const [rows, setRows] = useState(initial);
  const [scope, setScope] = useState<Record<string, "local" | "global">>({});
  const [recordPreference, setRecordPreference] = useState<Record<string, "version" | "replace">>({});
  const [busyId, setBusyId] = useState("");

  async function accept(row: PendingApplicationChangeView) {
    setBusyId(row.id);
    try {
      const res = await acceptPendingApplicationChange(row.id, {
        shareAcrossCompanies: (scope[row.id] || "local") === "global",
        recordPreference: recordPreference[row.id] || "version",
      });
      if (!res.ok) return void toast.error(res.message);
      setRows((current) => current.filter((item) => item.id !== row.id));
      toast.success(row.kind === "record" ? "已加入我的资料，之后可选择使用" : "已确认保存范围，下次可按该范围使用");
    } finally { setBusyId(""); }
  }

  async function ignore(row: PendingApplicationChangeView) {
    setBusyId(row.id);
    try {
      const res = await ignorePendingApplicationChange(row.id);
      if (!res.ok) return void toast.error(res.message);
      setRows((current) => current.filter((item) => item.id !== row.id));
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
          const matchingMemory = record ? currentMemories.find((item) => item.category === record.category && sameMemoryEntity(record.category, item.content, record.content)) : null;
          const selectedScope = scope[row.id] || "local";
          return <article key={row.id} className="rounded-xl border p-4">
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
              <p className="whitespace-pre-wrap break-words">{answer.answer}</p>
            </div>}
            {record && <div className="mt-3 grid gap-2 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2">
              {Object.entries(record.content).filter(([, value]) => value).map(([key, value]) => <p key={key} className={/description|responsibilities|text/.test(key) ? "sm:col-span-2" : ""}><span className="text-xs text-muted-foreground">{contentLabels[key] || key}</span><span className="mt-0.5 block whitespace-pre-wrap break-words">{value}</span></p>)}
            </div>}
            {record && matchingMemory && <details className="mt-3 rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">与资料库当前默认版比较</summary>
              <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{Object.entries(matchingMemory.content).filter(([, value]) => value).map(([key, value]) => `${contentLabels[key] || key}：${value}`).join("\n")}</div>
            </details>}
            {answer && <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name={`scope-${row.id}`} checked={selectedScope === "local"} onChange={() => setScope((current) => ({ ...current, [row.id]: "local" }))} />只用于当前岗位 / 网页</label>
              <label className="flex items-center gap-2"><input type="radio" name={`scope-${row.id}`} checked={selectedScope === "global"} onChange={() => setScope((current) => ({ ...current, [row.id]: "global" }))} />跨企业复用</label>
            </div>}
            {record && matchingMemory && <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name={`record-${row.id}`} checked={(recordPreference[row.id] || "version") === "version"} onChange={() => setRecordPreference((current) => ({ ...current, [row.id]: "version" }))} />保留为另一版，当前默认不变</label>
              <label className="flex items-center gap-2"><input type="radio" name={`record-${row.id}`} checked={recordPreference[row.id] === "replace"} onChange={() => setRecordPreference((current) => ({ ...current, [row.id]: "replace" }))} />把本次内容设为默认版</label>
            </div>}
            {record && !matchingMemory && <p className="mt-3 text-xs text-muted-foreground">这是新的完整经历。确认后加入经历记忆库，之后可在填写预览中选择使用。</p>}
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
