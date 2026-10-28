"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, Download, Plus, Undo2 } from "lucide-react";
import { zhCN } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AddScheduleDialog, type ScheduleApplication } from "@/components/calendar/add-schedule-dialog";
import { toDateKey } from "@/lib/dates";
import { downloadIcs, toIcs } from "@/lib/ics";
import { absoluteWhen, clock, kindFromText, SCHEDULE_KIND_LABELS } from "@/lib/interview-schedule";
import { setEventCompleted, setStepCompleted } from "@/lib/actions/schedule";
import { cn } from "@/lib/utils";

export type CalendarEvent = {
  id: string;
  date: string;
  /** End of a window (笔试/测评 that spans several days), or null for a
   * single-point deadline — same idea as StageHistory.nextDeadlineEnd. */
  dateEnd: string | null;
  label: string;
  /** Has a clock time (a booked slot), not just a day. */
  timed?: boolean;
  /** When a booked slot ends (same day). */
  until?: string | null;
  /** Marked 已完成 (your own events and 投递 steps can be). */
  done?: boolean;
  href: string;
};

// Local calendar day, not UTC — react-day-picker's `selected` is a local-midnight
// Date, so bucketing by `.toISOString()` (UTC) would shift events by a day for any
// timezone ahead of UTC.
const dayKey = toDateKey;

export function DeadlineCalendar({
  events,
  scheduleApps,
}: {
  events: CalendarEvent[];
  scheduleApps: ScheduleApplication[];
}) {
  const [selected, setSelected] = useState<Date | undefined>(undefined);
  const [now] = useState(() => Date.now());
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  // 「已完成」 / 撤销 for your own events (event-…) and a 投递's steps (stage-…).
  async function toggleDone(e: CalendarEvent) {
    const [kind, ...rest] = e.id.split("-");
    const id = rest.join("-");
    const done = !e.done;
    setBusy(e.id);
    try {
      const result = kind === "event" ? await setEventCompleted(id, done) : await setStepCompleted(id, done);
      if (!result.ok) return void toast.error(result.message);
      toast.success(done ? "已完成" : "已恢复为未完成");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const start = new Date(e.date);
      const end = e.dateEnd ? new Date(e.dateEnd) : start;
      // A 笔试/测评 window shows up on every day it's open, not just the
      // first — clicking day 3 of a 5-day window should still surface it.
      for (
        let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        d <= end;
        d.setDate(d.getDate() + 1)
      ) {
        const key = dayKey(d);
        const list = map.get(key) ?? [];
        list.push(e);
        map.set(key, list);
      }
    }
    return map;
  }, [events]);

  const eventDates = useMemo(
    () =>
      [...eventsByDay.keys()].map((k) => {
        const [y, m, d] = k.split("-").map(Number);
        return new Date(y, m - 1, d);
      }),
    [eventsByDay]
  );

  const upcoming = useMemo(
    () =>
      [...events]
        .filter((e) => new Date(e.date).getTime() >= now - 86400000)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [events, now]
  );

  const selectedKey = selected ? dayKey(selected) : null;
  const shownEvents = selectedKey ? eventsByDay.get(selectedKey) ?? [] : upcoming;

  return (
    <div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
      <Card className="w-fit">
        <CardContent className="pt-6">
          <Calendar
            mode="single"
            locale={zhCN}
            selected={selected}
            onSelect={setSelected}
            modifiers={{ hasEvent: eventDates }}
            modifiersClassNames={{
              hasEvent:
                "has-event relative after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {selected
                ? selected.toLocaleDateString("zh-CN", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "近期事项"}
            </p>
            <div className="flex shrink-0 gap-1.5">
              {events.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadIcs("求职罗盘-日程.ics", toIcs(events))}
                >
                  <Download />
                  导出到日历
                </Button>
              )}
              {selectedKey && (
                <AddScheduleDialog
                  applications={scheduleApps}
                  defaultDate={selectedKey}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Plus />
                      这天加日程
                    </Button>
                  }
                />
              )}
            </div>
          </div>
          {shownEvents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <CalendarDays className="size-8 text-muted-foreground/50" />
              <span className="text-sm">
                {selected ? "这天没有安排，点右上角加一个" : "暂无即将到来的截止日期"}
              </span>
            </div>
          ) : (
            shownEvents.map((e) => {
              const canComplete = e.id.startsWith("event-") || e.id.startsWith("stage-");
              return (
                <div
                  key={e.id}
                  className={cn("flex items-center justify-between gap-2 rounded-md border p-2 text-sm hover:bg-muted", e.done && "opacity-60")}
                >
                  <Link href={e.href} className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {kindFromText(e.label) !== "event" && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{SCHEDULE_KIND_LABELS[kindFromText(e.label)]}</span>}
                      <span className={cn("min-w-0 [overflow-wrap:anywhere]", e.done && "line-through")}>{e.label}</span>
                    </span>
                    <span className="shrink-0 pl-2 text-xs text-muted-foreground">
                      {e.dateEnd
                        ? `${new Date(e.date).toLocaleDateString("zh-CN")} - ${new Date(e.dateEnd).toLocaleDateString("zh-CN")}`
                        : `${absoluteWhen(e.date, !!e.timed)}${e.timed && e.until ? `–${clock(new Date(e.until))}` : ""}`}
                    </span>
                  </Link>
                  {canComplete && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
                      disabled={busy === e.id}
                      onClick={() => void toggleDone(e)}
                      aria-label={`${e.done ? "撤销完成" : "标为已完成"}：${e.label}`}
                    >
                      {e.done ? <Undo2 className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                      {e.done ? "撤销" : "已完成"}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
