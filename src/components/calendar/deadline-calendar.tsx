"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import { zhCN } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PersonalTaskFormDialog } from "@/components/dashboard/personal-task-form-dialog";
import { toDateKey } from "@/lib/dates";

export type CalendarEvent = {
  date: string;
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
      const key = dayKey(new Date(e.date));
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
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
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {selected
                ? selected.toLocaleDateString("zh-CN", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "近期事项"}
            </p>
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
          {shownEvents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <CalendarDays className="size-8 text-muted-foreground/50" />
              <span className="text-sm">
                {selected ? "这天没有安排，点右上角加一个" : "暂无即将到来的截止日期"}
              </span>
            </div>
          ) : (
            shownEvents.map((e, i) => (
              <Link
                key={i}
                href={e.href}
                className="flex items-center justify-between rounded-md border p-2 text-sm hover:bg-muted"
              >
                <span>{e.label}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.date).toLocaleDateString()}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
