"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Download, Plus } from "lucide-react";
import { zhCN } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PersonalTaskFormDialog } from "@/components/dashboard/personal-task-form-dialog";
import { toDateKey } from "@/lib/dates";
import { downloadIcs, toIcs } from "@/lib/ics";

export type CalendarEvent = {
  id: string;
  date: string;
  /** End of a window (笔试/测评 that spans several days), or null for a
   * single-point deadline — same idea as StageHistory.nextDeadlineEnd. */
  dateEnd: string | null;
  label: string;
  href: string;
};

type LinkOption = { id: string; label: string };

// Local calendar day, not UTC — react-day-picker's `selected` is a local-midnight
// Date, so bucketing by `.toISOString()` (UTC) would shift events by a day for any
// timezone ahead of UTC.
const dayKey = toDateKey;

export function DeadlineCalendar({
  events,
  positions,
  applications,
}: {
  events: CalendarEvent[];
  positions: LinkOption[];
  applications: LinkOption[];
}) {
  const [selected, setSelected] = useState<Date | undefined>(undefined);
  const [now] = useState(() => Date.now());

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
    <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
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
                "relative after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
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
                <PersonalTaskFormDialog
                  positions={positions}
                  applications={applications}
                  defaultDueDate={selectedKey}
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
            shownEvents.map((e) => (
              <Link
                key={e.id}
                href={e.href}
                className="flex items-center justify-between rounded-md border p-2 text-sm hover:bg-muted"
              >
                <span>{e.label}</span>
                <span className="text-xs text-muted-foreground">
                  {e.dateEnd
                    ? `${new Date(e.date).toLocaleDateString()} - ${new Date(e.dateEnd).toLocaleDateString()}`
                    : new Date(e.date).toLocaleDateString()}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
