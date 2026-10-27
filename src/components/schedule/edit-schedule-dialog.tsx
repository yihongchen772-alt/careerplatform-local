"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScheduleFields, scheduleDraftFrom, scheduleFromDraft, type ScheduleDraft } from "@/components/schedule/schedule-fields";
import { deleteCalendarItem, setStageSchedule, updateCalendarItem } from "@/lib/actions/schedule";
import type { ScheduleItem } from "@/lib/interview-schedule";

/**
 * 编辑 on a line of 接下来: the time, the link and the reminder of a 投递's
 * step, or all of that plus the title (and 删除) for a calendar item that
 * came from an email — which the mail got wrong or the company changed.
 */
export function EditScheduleDialog({ item, onClose }: { item: ScheduleItem | null; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      {item && <EditBody key={item.key} item={item} onClose={onClose} />}
    </Dialog>
  );
}

function EditBody({ item, onClose }: { item: ScheduleItem; onClose: () => void }) {
  const router = useRouter();
  const isEvent = item.source === "event";
  const [title, setTitle] = useState(item.title);
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraftFrom({ nextDeadline: item.startsAt, nextDeadlineEnd: item.endsAt, nextHasTime: item.hasTime, meetingInfo: item.meetingInfo, remindMinutes: item.remindMinutes ?? null }));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    const parsed = scheduleFromDraft(draft);
    if ("error" in parsed) return void toast.error(parsed.error);
    if (!parsed.value.nextDeadline) return void toast.error("请先选日期");
    setSaving(true);
    try {
      const result = isEvent ? await updateCalendarItem(item.sourceId, title, parsed.value) : await setStageSchedule(item.sourceId, parsed.value);
      if (!result.ok) return void toast.error(result.message);
      toast.success(parsed.value.nextHasTime ? "已保存，到点前会提醒你" : "已保存");
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      const result = await deleteCalendarItem(item.sourceId);
      if (!result.ok) return void toast.error(result.message);
      toast.success("已删除这个日程");
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="sm:max-w-xl [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>修改这个安排</DialogTitle>
        <DialogDescription>{isEvent ? "邮件读错了、或公司改了时间，在这里改。" : "改这一步的时间、链接和提醒；改轮次或标题请到投递详情。"}</DialogDescription>
      </DialogHeader>
      <div className="min-w-0 space-y-3">
        {isEvent ? (
          <div className="space-y-1.5">
            <Label htmlFor="edit-schedule-title" className="text-xs text-muted-foreground">标题</Label>
            <Input id="edit-schedule-title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
          </div>
        ) : (
          <p className="truncate text-sm font-medium">{[item.companyName, item.title].filter(Boolean).join(" · ")}</p>
        )}
        <ScheduleFields value={draft} onChange={setDraft} idPrefix="edit-schedule" excludeRowId={isEvent ? null : item.sourceId} />
      </div>
      <DialogFooter className="sm:justify-between">
        {isEvent ? (
          confirmDelete ? (
            <span className="flex items-center gap-1.5">
              <Button variant="destructive" size="sm" disabled={saving} onClick={remove}>确认删除</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>算了</Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>删除这个日程</Button>
          )
        ) : <span />}
        <span className="flex gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={saving} onClick={save}>{saving ? "保存中…" : "保存"}</Button>
        </span>
      </DialogFooter>
    </DialogContent>
  );
}
