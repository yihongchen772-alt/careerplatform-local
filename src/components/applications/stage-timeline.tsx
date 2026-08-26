"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AttachmentList } from "@/components/applications/attachment-list";
import { STAGE_BADGE_VARIANT, STAGE_LABELS, STAGE_ORDER } from "@/lib/stage-labels";
import { updateStageHistory, deleteStageHistory } from "@/lib/actions/applications";
import type { ApplicationStage } from "@prisma/client";

export type TimelineEntry = {
  id: string;
  stage: ApplicationStage;
  enteredAt: string;
  note: string | null;
  interviewFormat: string | null;
  interviewer: string | null;
  nextDeadline: string | null;
  nextDeadlineEnd: string | null;
  attachments: { id: string; url: string; name: string }[];
};

/** Date -> the value a <input type="datetime-local"> expects (local time). */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StageTimeline({
  entries,
  canDelete,
}: {
  entries: TimelineEntry[];
  canDelete: boolean;
}) {
  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <TimelineRow key={entry.id} entry={entry} canDelete={canDelete} />
      ))}
    </div>
  );
}

function TimelineRow({
  entry,
  canDelete,
}: {
  entry: TimelineEntry;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState<ApplicationStage>(entry.stage);
  const [enteredAt, setEnteredAt] = useState(toLocalInput(entry.enteredAt));
  const [note, setNote] = useState(entry.note ?? "");
  const [format, setFormat] = useState(entry.interviewFormat ?? "");
  const [interviewer, setInterviewer] = useState(entry.interviewer ?? "");
  const [nextDeadline, setNextDeadline] = useState(
    entry.nextDeadline?.slice(0, 10) ?? ""
  );
  const [nextDeadlineEnd, setNextDeadlineEnd] = useState(
    entry.nextDeadlineEnd?.slice(0, 10) ?? ""
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await updateStageHistory(entry.id, {
        stage,
        note: note || undefined,
        interviewFormat: format || undefined,
        interviewer: interviewer || undefined,
        nextDeadline: nextDeadline ? new Date(nextDeadline) : null,
        nextDeadlineEnd:
          nextDeadline && nextDeadlineEnd ? new Date(nextDeadlineEnd) : null,
        enteredAt,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("已更新");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-2 rounded-md border p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">阶段</Label>
            <Select value={stage} onValueChange={(v) => v && setStage(v as ApplicationStage)}>
              <SelectTrigger className="w-full">
                <SelectValue>{() => STAGE_LABELS[stage]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STAGE_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">时间</Label>
            <Input
              type="datetime-local"
              value={enteredAt}
              onChange={(e) => setEnteredAt(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">面试形式</Label>
            <Input value={format} onChange={(e) => setFormat(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">面试官</Label>
            <Input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
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
                窗口结束日期（笔试/测评窗口可选）
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
          <Label className="text-xs text-muted-foreground">复盘 / 备注</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={saving} onClick={handleSave}>
            {saving ? "保存中..." : "保存"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            取消
          </Button>
          {canDelete && (
            <ConfirmDeleteButton
              trigger={
                <Button size="sm" variant="ghost">
                  删除这条
                </Button>
              }
              title={`删除「${STAGE_LABELS[entry.stage]}」这条记录？`}
              onConfirm={async () => {
                const res = await deleteStageHistory(entry.id);
                if (!res.ok) toast.error(res.message);
                else toast.success("已删除，当前阶段已按剩下的记录重新计算");
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group border-l-2 pl-3">
      <div className="flex items-center gap-2">
        <Badge variant={STAGE_BADGE_VARIANT[entry.stage]}>
          {STAGE_LABELS[entry.stage]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {new Date(entry.enteredAt).toLocaleString()}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-6 px-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => setEditing(true)}
        >
          <Pencil className="mr-1 size-3" />
          改
        </Button>
      </div>
      {(entry.interviewFormat || entry.interviewer) && (
        <p className="mt-1 text-sm text-muted-foreground">
          {entry.interviewFormat} {entry.interviewer && `· ${entry.interviewer}`}
        </p>
      )}
      {entry.note && <p className="mt-1 text-sm">{entry.note}</p>}
      {entry.nextDeadline && (
        <p className="mt-1 text-xs text-muted-foreground">
          {entry.nextDeadlineEnd
            ? `下一步窗口：${new Date(entry.nextDeadline).toLocaleDateString()} - ${new Date(entry.nextDeadlineEnd).toLocaleDateString()}`
            : `下一步截止：${new Date(entry.nextDeadline).toLocaleDateString()}`}
        </p>
      )}
      {entry.attachments.length > 0 && (
        <div className="mt-2">
          <AttachmentList attachments={entry.attachments} />
        </div>
      )}
    </div>
  );
}
