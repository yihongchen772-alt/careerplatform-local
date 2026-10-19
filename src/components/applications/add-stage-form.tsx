"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addStageUpdate } from "@/lib/actions/applications";
import { addAttachment } from "@/lib/actions/attachments";
import { FileUploadButton } from "@/components/ui/file-upload-button";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { EMPTY_SCHEDULE, ScheduleFields, scheduleFromDraft, type ScheduleDraft } from "@/components/schedule/schedule-fields";
import type { ApplicationStage } from "@prisma/client";

export function AddStageForm({
  applicationId,
  currentStage,
}: {
  applicationId: string;
  currentStage: ApplicationStage;
}) {
  const [stage, setStage] = useState<ApplicationStage>(currentStage);
  const [stageLabel, setStageLabel] = useState("");
  const [endedStage, setEndedStage] = useState<string>(["REJECTED", "WITHDRAWN", "CANCELLED", "DECLINED", "ACCEPTED"].includes(currentStage) ? "" : currentStage);
  const [note, setNote] = useState("");
  const [interviewFormat, setInterviewFormat] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [schedule, setSchedule] = useState<ScheduleDraft>(EMPTY_SCHEDULE);
  const [pendingFiles, setPendingFiles] = useState<{ url: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  // The whole form stood open on every 投递 although 改进度 covers most
  // updates; it opens on demand (or from a 「记录进展」 link to #add-stage).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => { if (window.location.hash === "#add-stage") setOpen(true); };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const planned = scheduleFromDraft(schedule);
    if ("error" in planned) {
      toast.error(planned.error);
      return;
    }
    setLoading(true);
    try {
      const { stageHistoryId } = await addStageUpdate(applicationId, {
        stage,
        terminatedAtStage: (endedStage || null) as ApplicationStage | null,
        stageLabel: stageLabel || undefined,
        note: note || undefined,
        interviewFormat: interviewFormat || undefined,
        interviewer: interviewer || undefined,
        nextDeadline: planned.value.nextDeadline ?? undefined,
        nextDeadlineEnd: planned.value.nextDeadlineEnd ?? undefined,
        nextHasTime: planned.value.nextHasTime,
        meetingInfo: planned.value.meetingInfo,
        remindMinutes: planned.value.remindMinutes,
      });
      await Promise.all(
        pendingFiles.map((f) => addAttachment({ stageHistoryId, ...f }))
      );
      toast.success(stage === "REJECTED" ? "已记录未通过，这条投递会显示在看板的未通过区域" : planned.value.nextHasTime ? "已更新进展，时间已进日历，到点前会提醒你" : "已更新进展");
      setStage(stage);
      setStageLabel("");
      setNote("");
      setInterviewFormat("");
      setInterviewer("");
      setSchedule(EMPTY_SCHEDULE);
      setPendingFiles([]);
    } catch {
      toast.error("更新失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <div id="add-stage" className="scroll-mt-24 rounded-md border p-4">
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 text-left" aria-expanded={false}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">记录企业进展</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">进了一面、收到测评、被拒了…… 一般点页头的「改进度」就够；要写面试形式、面试官、复盘笔记或附件时在这里记。</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium">手动记一轮<ChevronDown className="size-3.5" /></span>
        </button>
      </div>
    );
  }

  return (
    <form id="add-stage" onSubmit={handleSubmit} className="scroll-mt-24 space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">记录企业进展</p><button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>收起</button></div>
      <p className="text-xs text-muted-foreground">企业流程不固定。先选宽泛类别，再写官网或邮件里的实际阶段；可跳步、重复或直接记录未通过。</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {["REJECTED", "WITHDRAWN", "CANCELLED"].includes(stage) && <label className="space-y-1 text-sm">在哪个阶段结束<select className="block w-full rounded border bg-background p-2" value={endedStage} onChange={(e) => setEndedStage(e.target.value)}><option value="">未记录</option>{Object.entries(STAGE_LABELS).filter(([key]) => !["REJECTED", "WITHDRAWN", "CANCELLED", "ACCEPTED", "DECLINED"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">新状态</Label>
          <Select
            value={stage}
            onValueChange={(v) => v && setStage(v as ApplicationStage)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(value: ApplicationStage) => STAGE_LABELS[value]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STAGE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">企业阶段名称（可选）</Label>
          <Input value={stageLabel} maxLength={100} onChange={(e) => setStageLabel(e.target.value)} placeholder="例如：群面 / 技术终面 / 测评未通过" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">面试形式</Label>
          <Input
            value={interviewFormat}
            onChange={(e) => setInterviewFormat(e.target.value)}
            placeholder="电话 / 视频 / 现场"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">面试官</Label>
          <Input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/40 p-3">
        <p className="text-xs font-medium">时间安排 <span className="font-normal text-muted-foreground">（面试时间 / 笔试截止，可不填）</span></p>
        <ScheduleFields value={schedule} onChange={setSchedule} idPrefix="add-stage-schedule" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">复盘笔记</Label>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">附件（笔试截图/面经等，可多个）</Label>
        <div className="flex flex-wrap items-center gap-2">
          <FileUploadButton
            label="添加附件"
            onUploaded={(f) => setPendingFiles((prev) => [...prev, f])}
          />
          {pendingFiles.map((f, i) => (
            <span
              key={i}
              className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
            >
              {f.name}
            </span>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "保存中..." : "保存更新"}
      </Button>
    </form>
  );
}
