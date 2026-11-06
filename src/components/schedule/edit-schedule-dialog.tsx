"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScheduleFields, scheduleDraftFrom, scheduleFromDraft, type ScheduleDraft } from "@/components/schedule/schedule-fields";
import { clearStageTime, deleteCalendarItem, moveStageSchedule, setStageSchedule, updateCalendarItem } from "@/lib/actions/schedule";
import { matchApplication } from "@/lib/application-search";
import type { ScheduleItem } from "@/lib/interview-schedule";

type MoveTarget = { id: string; companyName: string; title: string; aliases?: string[] };

/**
 * 编辑 on a line of 接下来: the time, the link and the reminder of a 投递's
 * step, or all of that plus the title (and 删除) for a calendar item that
 * came from an email — which the mail got wrong or the company changed.
 */
export function EditScheduleDialog({ item, applications = [], onClose }: { item: ScheduleItem | null; applications?: MoveTarget[]; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      {item && <EditBody key={item.key} item={item} applications={applications} onClose={onClose} />}
    </Dialog>
  );
}

function EditBody({ item, applications, onClose }: { item: ScheduleItem; applications: MoveTarget[]; onClose: () => void }) {
  const router = useRouter();
  const isEvent = item.source === "event";
  const [title, setTitle] = useState(item.title);
  const [draft, setDraft] = useState<ScheduleDraft>(() => scheduleDraftFrom({ nextDeadline: item.startsAt, nextDeadlineEnd: item.endsAt, nextHasTime: item.hasTime, meetingInfo: item.meetingInfo, remindMinutes: item.remindMinutes ?? null }));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moving, setMoving] = useState(false);
  const [query, setQuery] = useState("");
  const others = applications.filter((app) => app.id !== item.applicationId);
  const results = query.trim()
    ? others.filter((app) => matchApplication({ companyName: app.companyName, aliases: app.aliases, title: app.title }, query.trim())).slice(0, 8)
    : others.filter((app) => app.companyName === item.companyName).concat(others.filter((app) => app.companyName !== item.companyName)).slice(0, 6);

  async function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) {
    setSaving(true);
    try {
      const result = await action();
      if (!result.ok) return void toast.error(result.message);
      toast.success(done);
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

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

  const remove = () => isEvent ? run(() => deleteCalendarItem(item.sourceId), "已删除这个日程，提醒邮件也不会再把它加回来") : run(() => clearStageTime(item.sourceId), "已清掉这个时间，提醒邮件也不会再把它加回来");

  return (
    <DialogContent className="sm:max-w-xl [&>*]:min-w-0">
      <DialogHeader>
        <DialogTitle>修改这个安排</DialogTitle>
        <DialogDescription>{isEvent ? "邮件读错了、或公司改了时间，在这里改。改过的不会被提醒邮件改回去。" : "改这一步的时间、链接和提醒，改过的不会被提醒邮件改回去。改轮次请到投递详情。"}</DialogDescription>
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
        {!isEvent && (
          moving ? (
            <div className="space-y-1.5 rounded-xl border border-border/60 p-3">
              <Label htmlFor="edit-schedule-move" className="text-xs text-muted-foreground">这个时间属于哪条投递？</Label>
              <Input id="edit-schedule-move" value={query} placeholder="搜公司或岗位，拼音首字母也行" onChange={(event) => setQuery(event.target.value)} />
              <div className="max-h-44 space-y-0.5 overflow-y-auto">
                {results.map((app) => (
                  <button key={app.id} type="button" disabled={saving} onClick={() => run(() => moveStageSchedule(item.sourceId, app.id), `已移到 ${app.companyName} · ${app.title}`)} className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted">
                    <span className="font-medium">{app.companyName}</span><span className="text-muted-foreground"> · {app.title}</span>
                  </button>
                ))}
                {results.length === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">没有找到，换个关键词试试</p>}
              </div>
              <button type="button" disabled={saving} onClick={() => run(() => moveStageSchedule(item.sourceId, null), "已改成单独的日程")} className="text-xs font-medium text-primary hover:underline">不属于任何投递，单独放日历</button>
            </div>
          ) : (
            <button type="button" onClick={() => setMoving(true)} className="text-xs font-medium text-primary hover:underline">不是这条投递？移到别的投递</button>
          )
        )}
      </div>
      <DialogFooter className="sm:justify-between">
        {confirmDelete ? (
          <span className="flex items-center gap-1.5">
            <Button variant="destructive" size="sm" disabled={saving} onClick={remove}>{isEvent ? "确认删除" : "确认清掉"}</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>算了</Button>
          </span>
        ) : (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>{isEvent ? "删除这个日程" : "这个时间不对，清掉"}</Button>
        )}
        <span className="flex gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button disabled={saving} onClick={save}>{saving ? "保存中…" : "保存"}</Button>
        </span>
      </DialogFooter>
    </DialogContent>
  );
}
