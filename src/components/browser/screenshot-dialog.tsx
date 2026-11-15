"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ExternalLink, Loader2, Sparkles } from "lucide-react";
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
import { STAGE_LABELS } from "@/lib/stage-labels";
import { matchApplicationForScreenshot, type ScreenshotExtraction } from "@/lib/screenshot-extract";

export type ApplicationOption = { id: string; label: string; companyName: string };

function formatExtractedMoment(value: string, hasTime: boolean): string {
  if (!hasTime) return value.slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

type AnalyzeOutcome =
  | { ok: true; extraction: ScreenshotExtraction }
  | { ok: false; error: string };

async function requestScreenshotAnalysis(
  shot: { dataUrl: string; title: string; url?: string },
  signal?: AbortSignal
): Promise<AnalyzeOutcome> {
  try {
    const res = await fetch("/api/desktop-browser/screenshot/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl: shot.dataUrl, title: shot.title, url: shot.url }),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.extraction) {
      return { ok: false, error: body?.error || "暂时没能识别截图内容" };
    }
    return { ok: true, extraction: body.extraction as ScreenshotExtraction };
  } catch {
    return { ok: false, error: "识别服务暂时不可用" };
  }
}

/** Files a page screenshot and extracts exam/interview times, links, and codes with Vision AI. */
export function ScreenshotDialog({
  open,
  onOpenChange,
  shot,
  applications,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shot: { dataUrl: string; title: string; url?: string };
  applications: ApplicationOption[];
}) {
  const router = useRouter();
  const guessed = applications.find((a) => shot.title && shot.title.includes(a.companyName));
  const [applicationId, setApplicationId] = useState(guessed?.id ?? applications[0]?.id ?? "");
  const touchedAppRef = useRef(false);
  const [name, setName] = useState(() => {
    const date = new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
    return `${shot.title || "网申页面"} ${date}`.slice(0, 100);
  });
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(() => open && !!shot.dataUrl);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ScreenshotExtraction | null>(null);
  const [applyExtraction, setApplyExtraction] = useState(true);

  const applyOutcome = useCallback(
    (outcome: AnalyzeOutcome) => {
      if (!outcome.ok) {
        setAnalyzeError(outcome.error);
        return;
      }
      const next = outcome.extraction;
      setExtraction(next);
      const hasActionable = !!(next.startsAt || next.entryUrl || next.accessCode);
      setApplyExtraction(hasActionable || !!next.suggestedStage);
      if (!touchedAppRef.current && !guessed) {
        const matched = matchApplicationForScreenshot(applications, next.companyName, shot.title);
        if (matched) setApplicationId(matched.id);
      }
    },
    [applications, guessed, shot.title]
  );

  const runAnalyze = useCallback(async () => {
    if (!shot.dataUrl) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    const outcome = await requestScreenshotAnalysis(shot);
    applyOutcome(outcome);
    setAnalyzing(false);
  }, [applyOutcome, shot]);

  useEffect(() => {
    if (!open || !shot.dataUrl) return;
    const controller = new AbortController();
    void requestScreenshotAnalysis(shot, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      applyOutcome(outcome);
      setAnalyzing(false);
    });
    return () => controller.abort();
  }, [open, shot, applyOutcome]);

  async function handleSave() {
    if (!applicationId || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/desktop-browser/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataUrl: shot.dataUrl,
          applicationId,
          name,
          applyExtraction: !!(extraction && applyExtraction),
          extraction: extraction ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "保存失败");
      toast.success(body.appliedSchedule ? "截图已存档，并同步更新了时间/链接到日程" : "截图已存到这条投递的附件里");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>截图存到投递附件</DialogTitle>
          <DialogDescription>投递成功页、测评说明、笔试时间——自动识别时间与链接并同步至对应投递。</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.dataUrl} alt="页面截图" className="max-h-56 w-full object-contain object-top" />
        </div>

        <div className="rounded-md border bg-muted/35 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <Sparkles className="size-3.5 text-primary" />
              AI 截图信息提取
            </span>
            <Button type="button" variant="ghost" size="xs" disabled={analyzing} onClick={() => void runAnalyze()}>
              {analyzing ? <><Loader2 className="mr-1 size-3 animate-spin" />识别中…</> : extraction ? "重新识别" : "识别内容"}
            </Button>
          </div>
          {analyzing && !extraction && (
            <p className="text-muted-foreground">正在从截图中识别笔试/面试时间、入口链接与编号…</p>
          )}
          {analyzeError && !analyzing && (
            <p className="text-muted-foreground">{analyzeError}（仍可直接保存截图附件）</p>
          )}
          {extraction && (
            <div className="space-y-1.5 text-muted-foreground">
              <p className="text-foreground">{extraction.summary}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {extraction.startsAt && (
                  <span className="inline-flex items-center gap-1 text-foreground">
                    <CalendarClock className="size-3 text-primary" />
                    时间：{formatExtractedMoment(extraction.startsAt, extraction.hasTime)}{extraction.endsAt ? ` ~ ${formatExtractedMoment(extraction.endsAt, extraction.hasTime)}` : ""}
                  </span>
                )}
                {extraction.suggestedStage && (
                  <span>阶段建议：{STAGE_LABELS[extraction.suggestedStage]}</span>
                )}
                {extraction.accessCode && (
                  <span>口令/编号：{extraction.accessCode}</span>
                )}
              </div>
              {extraction.entryUrl && (
                <p className="inline-flex items-center gap-1 truncate max-w-full">
                  <ExternalLink className="size-3 shrink-0" />
                  <span className="truncate">{extraction.entryUrl}</span>
                </p>
              )}
              {applications.length > 0 && (extraction.startsAt || extraction.entryUrl || extraction.accessCode || extraction.suggestedStage) && (
                <label className="flex items-center gap-2 pt-1 text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyExtraction}
                    onChange={(e) => setApplyExtraction(e.target.checked)}
                    className="rounded border-input"
                  />
                  <span>同时将时间、链接与阶段写入这条投递的日程与备注</span>
                </label>
              )}
            </div>
          )}
        </div>

        {applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有进行中的投递记录，先「记为已投递」再截图。</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">存到哪条投递</Label>
              <Select value={applicationId} onValueChange={(v) => { if (v) { touchedAppRef.current = true; setApplicationId(v); } }}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(value: string) => applications.find((a) => a.id === value)?.label ?? "选投递"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {applications.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">文件名</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" disabled={!applicationId || saving || !name.trim()} onClick={handleSave}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
