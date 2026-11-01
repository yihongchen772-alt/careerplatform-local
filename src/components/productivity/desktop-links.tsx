"use client";
import { CalendarClock, ClipboardPlus, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The small windows that live on the desktop, opened from the bottom of 日历. */
export function DesktopLinks() {
  function open(kind: "notes" | "calendar" | "capture") {
    if (window.desktopProductivity) void window.desktopProductivity.open(kind);
    else window.open(`/desktop/${kind}`, "_blank", "noopener");
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="mr-1">桌面小窗</span>
      <Button size="sm" variant="ghost" onClick={() => open("notes")}><StickyNote />便利贴</Button>
      <Button size="sm" variant="ghost" onClick={() => open("calendar")}><CalendarClock />小日历 / 提醒</Button>
      <Button size="sm" variant="ghost" onClick={() => open("capture")}><ClipboardPlus />快速捕获岗位</Button>
    </div>
  );
}
