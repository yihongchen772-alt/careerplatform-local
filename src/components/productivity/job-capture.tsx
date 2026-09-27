"use client";
import { useEffect, useRef, useState } from "react";
import { captureProvider } from "@/lib/actions/job-capture";
import { parseJd } from "@/lib/actions/jd-parse";
import { normalizeJobUrl } from "@/lib/job-capture";
import { PositionFormDialog, type PositionFormInitial } from "@/components/pool/position-form-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
export function JobCapture() {
  const [text, setText] = useState(""), [url, setUrl] = useState(""), [provider, setProvider] = useState("正在检查 AI 设置…");
  const [busy, setBusy] = useState(false), [initial, setInitial] = useState<PositionFormInitial | null>(null), [generation, setGeneration] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    void window.desktopProductivity?.state().then((s) => { const value = s.clipboard.trim(); if (!value) return; if (normalizeJobUrl(value)) setUrl(value); else setText(value); });
    void captureProvider().then((r) => setProvider(r.ok && r.data ? `${r.data.provider}${r.data.endpoint ? `（${r.data.endpoint}）` : ""}` : "未配置 AI，可手动填写"));
  }, []);
  async function review(parse: boolean) {
    if (lock.current) return; lock.current = true; setBusy(true);
    let data: Awaited<ReturnType<typeof parseJd>> | null = null;
    try {
      if (parse) { data = await parseJd({ text, url, capture: true }); if (!data.ok) toast.warning(data.message); }
      const parsed = data?.ok ? data.data : null;
      setInitial({ companyName: parsed?.companyName || "", title: parsed?.title || "", track: parsed?.track || null, department: parsed?.department || null, location: parsed?.location || null, salaryMin: parsed?.salaryMin ?? null, salaryMax: parsed?.salaryMax ?? null, jdUrl: url || null, jdText: text || parsed?.jdText || null, source: "快速捕获", deadline: parsed?.deadline || null, recruitmentType: parsed?.recruitmentType || null, scoreBreakdown: null });
      setGeneration((n) => n + 1);
    } catch { toast.error("解析失败，仍可手动填写"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main className="mx-auto max-w-xl space-y-4 p-5"><h1 className="text-xl font-semibold">岗位快速捕获</h1><p className="text-sm text-muted-foreground">复制岗位链接或 JD 后，通过托盘或 Ctrl / ⌘ + Shift + J 打开。只在主动唤起时读取一次剪贴板。</p>
    <label className="block text-sm">原始链接<input className="mt-1 w-full rounded border p-2" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
    <label className="block text-sm">JD 正文<textarea className="mt-1 w-full rounded border p-2" rows={9} maxLength={50000} value={text} onChange={(e) => setText(e.target.value)} placeholder="登录或动态页面无法读取时，请在浏览器复制正文，或使用内置浏览器收藏岗位。" /></label>
    <p className="text-xs text-muted-foreground">点击解析后，最多 12,000 字的正文将发送至你配置的 {provider}；不发送个人简历、偏好或浏览器 Cookie。AI 可能识别错误，请核对后保存。</p>
    <div className="flex gap-2"><Button disabled={busy || (!text.trim() && !url.trim())} onClick={() => review(true)}>{busy ? "解析中…" : "解析并核对"}</Button><Button variant="outline" disabled={busy} onClick={() => review(false)}>手动填写</Button></div>
    {initial && <PositionFormDialog key={generation} mode="create" captureMode initial={initial} open onOpenChange={(open) => { if (!open) setInitial(null); }} />}
  </main>;
}
