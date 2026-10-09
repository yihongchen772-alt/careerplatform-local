"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApplicationSnapshot } from "@/types/desktop-bridge";
import type { IdentitySite } from "@/lib/application-identity";
import { sourceFromUrl } from "@/lib/source-from-url";
import { recognizeApplication, type Recognition } from "@/components/browser/recognize-application";

export type PoolPosition = { id: string; label: string; companyName: string; source: string | null; title: string; jdUrl: string | null };
type ResumeOption = { id: string; name: string; isDefault: boolean };

const NEW = "__new__";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The step after submitting a 网申: turn the candidate-pool entry into an
 * application, or create one from scratch, without leaving the browser.
 * The company and job are recognised from the pages this tab went through
 * (the job page, the form's 应聘岗位, the success page) so the usual case is
 * one click; anything typed by the applicant is never overwritten.
 */
export function MarkAppliedFromBrowserDialog({
  open,
  onOpenChange,
  pageUrl,
  positions,
  sites,
  resumeVersions,
  initialPositionId, initialResumeId, initialRecognition,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageUrl: string;
  positions: PoolPosition[];
  sites: IdentitySite[];
  resumeVersions: ResumeOption[];
  initialPositionId?: string; initialResumeId?: string;
  /** Already worked out when 投递成功 was detected. */
  initialRecognition?: Recognition | null;
}) {
  const router = useRouter();
  const [positionId, setPositionId] = useState(initialPositionId || initialRecognition?.positionId || NEW);
  // Kept behind a matched pool job too, so 「新建一条」 starts from the recognised names.
  const [companyName, setCompanyName] = useState(initialRecognition?.companyName || "");
  const [title, setTitle] = useState(initialRecognition?.title || "");
  const [recognition, setRecognition] = useState<Recognition | null>(initialPositionId ? null : initialRecognition ?? null);
  const [recognizing, setRecognizing] = useState(!initialPositionId && !initialRecognition);
  const touched = useRef({ position: false, company: false, title: false });
  const [appliedDate, setAppliedDate] = useState(todayKey);
  const [source, setSource] = useState(sourceFromUrl(pageUrl));
  const [resumeVersionId, setResumeVersionId] = useState(
    initialResumeId || resumeVersions.find((r) => r.isDefault)?.id || resumeVersions[0]?.id || ""
  );
  const [archive, setArchive] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || initialPositionId || initialRecognition) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const snapshot = await window.desktopBridge?.applicationSnapshot();
        if (!snapshot || controller.signal.aborted) return;
        const found = await recognizeApplication(snapshot, positions, sites, controller.signal);
        if (controller.signal.aborted) return;
        setRecognition(found);
        // Late results never undo what the applicant has already chosen or typed.
        if (found.positionId && positions.some((p) => p.id === found.positionId) && !touched.current.position) setPositionId(found.positionId);
        if (!touched.current.company && found.companyName) setCompanyName(found.companyName);
        if (!touched.current.title && found.title) setTitle(found.title);
      } catch {
        // Unrecognised: the fields stay for the applicant to fill.
      } finally {
        if (!controller.signal.aborted) setRecognizing(false);
      }
    })();
    return () => controller.abort();
  }, [open, initialPositionId, initialRecognition, positions, sites]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const selected = positions.find((p) => p.id === positionId);
      if (!selected && (!companyName.trim() || !title.trim())) { toast.error("公司和岗位必填"); return; }
      const captured: ApplicationSnapshot | null = archive ? await window.desktopBridge?.applicationSnapshot() || null : null;
      // The material package keeps only the form; page text and history were for recognition.
      const snapshot = captured ? { url: captured.url, fields: captured.fields, positionId: captured.positionId, resumeVersionId: captured.resumeVersionId, variantId: captured.variantId } : null;
      const res = await fetch("/api/desktop-browser/record-application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName: selected?.companyName || companyName.trim(), title: selected ? selected.title : title.trim(), appliedDate: new Date(appliedDate).toISOString(), source, positionId: selected?.id, resumeVersionId: resumeVersionId || undefined, applyUrl: pageUrl, snapshot: snapshot || undefined }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error);
      toast.success(`已记为投递：${selected?.companyName || companyName.trim()} · ${selected ? selected.title : title.trim()}。之后打开这家公司的「我的投递」页，可以一键设为进度页自动同步阶段`);
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  const recognizedSomething = !!recognition && (!!recognition.positionId || !!recognition.companyName || !!recognition.title);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>记为已投递</DialogTitle>
          <DialogDescription>网申提交完了，顺手把它记进投递记录。</DialogDescription>
        </DialogHeader>
        {!initialPositionId && (
          <p className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground" role="status">
            {recognizing ? (
              <><Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />正在从刚才的页面识别公司和岗位…</>
            ) : recognizedSomething ? (
              <><Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" /><span>已自动识别{recognition!.evidence.length ? `（依据：${recognition!.evidence.join("、")}）` : ""}，请核对后保存。</span></>
            ) : (
              <>没能从页面识别出公司和岗位，请选择候选池岗位或手动填写。</>
            )}
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">投的是候选池里的哪个岗位</Label>
            <Select value={positionId} onValueChange={(v) => { if (!v) return; touched.current.position = true; setPositionId(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) => (value === NEW ? "不在候选池里，新建一条" : (positions.find((p) => p.id === value)?.label ?? "选岗位"))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {positions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value={NEW}>不在候选池里，新建一条</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {positionId === NEW && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">公司 *</Label>
                <Input value={companyName} onChange={(e) => { touched.current.company = true; setCompanyName(e.target.value); }} placeholder={recognizing ? "识别中…" : "招聘的公司"} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">岗位 *</Label>
                <Input value={title} onChange={(e) => { touched.current.title = true; setTitle(e.target.value); }} placeholder={recognizing ? "识别中…" : "投递的岗位"} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">投递日期</Label>
              <Input type="date" value={appliedDate} onChange={(e) => setAppliedDate(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">渠道</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
          </div>
          {resumeVersions.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">用的简历</Label>
              <Select value={resumeVersionId} onValueChange={(v) => setResumeVersionId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(value: string) => resumeVersions.find((r) => r.id === value)?.name ?? "选简历"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {resumeVersions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} />确认已经提交，保存本次简历、资料和当前可读取的填写内容</label>
          <DialogFooter>
            <Button type="submit" disabled={loading || (recognizing && positionId === NEW && !companyName && !title)}>
              {loading ? "保存中..." : "记为已投递"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
