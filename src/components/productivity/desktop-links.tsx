"use client";
import { Button } from "@/components/ui/button";
export function DesktopLinks() {
  function open(kind: "notes" | "calendar" | "capture") {
    if (window.desktopProductivity) void window.desktopProductivity.open(kind);
    else window.open(`/desktop/${kind}`, "_blank", "noopener");
  }
  return <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => open("notes")}>桌面便利贴</Button><Button variant="outline" onClick={() => open("calendar")}>小日历 / 提醒</Button><Button variant="outline" onClick={() => open("capture")}>快速捕获岗位</Button></div>;
}
