"use client";

import { useState } from "react";
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
import { STAGE_LABELS, STAGE_ORDER } from "@/lib/stage-labels";
import type { ApplicationStage } from "@prisma/client";

/** The stage right after the current one, or the current stage itself if
 * it's already the last one in the pipeline (OFFER/terminal stages) — those
 * don't have an obvious "next", so falling back avoids guessing wrong. */
function nextStageAfter(current: ApplicationStage): ApplicationStage {
  const i = STAGE_ORDER.indexOf(current);
  return i >= 0 && i + 1 < STAGE_ORDER.length ? STAGE_ORDER[i + 1] : current;
}

export function AddStageForm({
  applicationId,
  currentStage,
}: {
  applicationId: string;
  currentStage: ApplicationStage;
}) {
  const [stage, setStage] = useState<ApplicationStage>(() =>
    nextStageAfter(currentStage)
  );
  const [note, setNote] = useState("");
  const [interviewFormat, setInterviewFormat] = useState("");
  const [interviewer, setInterviewer] = useState("");
  const [nextDeadline, setNextDeadline] = useState("");
  const [nextDeadlineEnd, setNextDeadlineEnd] = useState("");
  const [pendingFiles, setPendingFiles] = useState<{ url: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { stageHistoryId } = await addStageUpdate(applicationId, {
        stage,
        note: note || undefined,
        interviewFormat: interviewFormat || undefined,
        interviewer: interviewer || undefined,
        nextDeadline: nextDeadline ? new Date(nextDeadline) : undefined,
        nextDeadlineEnd:
          nextDeadline && nextDeadlineEnd ? new Date(nextDeadlineEnd) : undefined,
      });
      await Promise.all(
        pendingFiles.map((f) => addAttachment({ stageHistoryId, ...f }))
      );
      toast.success("已更新进展");
      setStage((s) => nextStageAfter(s));
      setNote("");
      setInterviewFormat("");
      setInterviewer("");
      setNextDeadline("");
      setNextDeadlineEnd("");
      setPendingFiles([]);
    } catch {
      toast.error("更新失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border p-4">
      <p className="text-sm font-medium">添加进展更新</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">下一步截止日期</Label>
          <Input
            type="date"
            value={nextDeadline}
            onChange={(e) => {
              setNextDeadline(e.target.value);
              if (!e.target.value) setNextDeadlineEnd("");
            }}
          />
        </div>
        {nextDeadline && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              窗口结束日期（可选——笔试/测评这类给一段时间窗口的，填这个）
            </Label>
            <Input
              type="date"
              min={nextDeadline}
              value={nextDeadlineEnd}
              onChange={(e) => setNextDeadlineEnd(e.target.value)}
            />
          </div>
        )}
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
