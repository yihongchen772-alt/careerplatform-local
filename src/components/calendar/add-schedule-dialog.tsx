"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
import type { ApplicationStage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMPTY_SCHEDULE, ScheduleFields, scheduleFromDraft, type ScheduleDraft } from "@/components/schedule/schedule-fields";
import { defaultScheduleStage, scheduleStageChoices } from "@/lib/interview-schedule";
import { matchApplication } from "@/lib/application-search";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { addStageSchedule } from "@/lib/actions/schedule";
import { saveEvent } from "@/lib/actions/productivity";
import { toDateKey } from "@/lib/dates";

export type ScheduleApplication = { id: string; companyName: string; aliases: string[]; title: string; currentStage: ApplicationStage };

/**
 * The one place to put an interview, a 笔试 or any other dated item on the
 * calendar: pick the 投递 it belongs to (its time then shows on that 投递
 * too), or leave it unlinked for something of your own.
 */
export function AddScheduleDialog({ applications, defaultDate, trigger }: { applications: ScheduleApplication[]; defaultDate?: string; trigger?: ReactElement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [round, setRound] = useState<ApplicationStage>("INTERVIEW_1");
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<ScheduleDraft>({ ...EMPTY_SCHEDULE, date: defaultDate ?? "" });
  const [saving, setSaving] = useState(false);

  const chosen = applications.find((app) => app.id === applicationId) ?? null;
  const matches = useMemo(() => {
    const term = query.trim();
    if (!term) return [];
    return applications.filter((app) => matchApplication({ companyName: app.companyName, aliases: app.aliases, title: app.title }, term)).slice(0, 6);
  }, [applications, query]);

  function pick(app: ScheduleApplication | null) {
    setApplicationId(app?.id ?? null);
    setQuery("");
    if (app) setRound(defaultScheduleStage(app.currentStage));
  }

  function reset() {
    setQuery("");
    setApplicationId(null);
    setTitle("");
    setDraft({ ...EMPTY_SCHEDULE, date: defaultDate ?? "" });
  }

  async function save() {
    const parsed = scheduleFromDraft(draft);
    if ("error" in parsed) return void toast.error(parsed.error);
    const value = parsed.value;
    if (!value.nextDeadline) return void toast.error("请先选日期");
    if (!chosen && !title.trim()) return void toast.error("写一下这是什么事，例如「宝洁一面」");
    setSaving(true);
    try {
      if (chosen) {
        const result = await addStageSchedule(chosen.id, round, value);
        if (!result.ok) return void toast.error(result.message);
        toast.success(`已加到 ${chosen.companyName} 的「${STAGE_LABELS[round]}」，${value.nextHasTime ? "到点前会提醒你" : "截止日期已记上"}`);
      } else {
        const day = value.nextHasTime ? toDateKey(value.nextDeadline) : value.nextDeadline.toISOString().slice(0, 10);
        const startsAt = value.nextHasTime ? value.nextDeadline : new Date(`${day}T00:00:00`);
        const result = await saveEvent({
          title: title.trim(),
          description: value.meetingInfo ?? "",
          startsAt,
          // A booked slot's end, or the last day of a 笔试 window (as a local day, like the start).
          endsAt: value.nextDeadlineEnd ? (value.nextHasTime ? value.nextDeadlineEnd : new Date(`${value.nextDeadlineEnd.toISOString().slice(0, 10)}T00:00:00`)) : null,
          allDay: !value.nextHasTime,
          dateKey: day,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          noteId: null,
          offsetMinutes: value.nextHasTime ? value.remindMinutes : null,
        });
        if (!result.ok) return void toast.error(result.message);
        toast.success("已加入日历");
      }
      setOpen(false);
      reset();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const rounds = chosen ? scheduleStageChoices(chosen.currentStage) : [];
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) reset(); }}>
      <DialogTrigger render={trigger ?? <Button size="sm"><CalendarPlus />添加面试 / 笔试</Button>} />
      <DialogContent className="sm:max-w-xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>添加到日历</DialogTitle>
          <DialogDescription>面试、笔试、测评截止都从这里加。选了投递，时间会同时出现在那条投递里。</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">属于哪条投递（没有就不选）</Label>
            {chosen ? (
              <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-input px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium">{chosen.companyName} · {chosen.title}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => pick(null)}>换一个</Button>
              </div>
            ) : (
              <>
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜公司或岗位，例如 宝洁" aria-label="搜索投递" />
                {matches.length > 0 && (
                  <ul className="overflow-hidden rounded-xl border border-border/70">
                    {matches.map((app) => (
                      <li key={app.id}>
                        <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => pick(app)}>
                          <span className="min-w-0 truncate">{app.companyName} · {app.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{STAGE_LABELS[app.currentStage]}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {query.trim() && matches.length === 0 && <p className="text-xs text-muted-foreground">没找到这条投递，可以不选，直接写标题。</p>}
              </>
            )}
          </div>
          {chosen ? (
            <div className="space-y-1.5">
              <Label htmlFor="add-schedule-round" className="text-xs text-muted-foreground">是哪一轮</Label>
              <select id="add-schedule-round" value={round} onChange={(event) => setRound(event.target.value as ApplicationStage)} className="h-8 w-full rounded-xl border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30">
                {rounds.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="add-schedule-title" className="text-xs text-muted-foreground">标题</Label>
              <Input id="add-schedule-title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="例如：宝洁一面" />
            </div>
          )}
          <ScheduleFields value={draft} onChange={setDraft} idPrefix="add-schedule" autoFocusDate />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button disabled={saving} onClick={save}>{saving ? "保存中…" : "加入日历"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
