import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { MiniCalendar } from "@/components/productivity/mini-calendar";
import { PageHero } from "@/components/layout/page-hero";
import { buttonVariants } from "@/components/ui/button";

/** A personal 日程 opened from the calendar or 待办, inside the main app (?id= selects it). */
export default function CalendarEventsPage() {
  return (
    <div className="space-y-6">
      <PageHero title="我的日程" icon={CalendarDays} description="自己记的事项和提醒；面试、笔试的时间在各条投递里改。" actions={<Link href="/calendar" className={buttonVariants({ variant: "outline", size: "sm" })}>日历视图</Link>} />
      <MiniCalendar embedded />
    </div>
  );
}
