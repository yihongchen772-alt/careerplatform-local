import { MiniCalendar } from "@/components/productivity/mini-calendar";

/** A personal 日程 opened from the calendar or 待办, inside the main app (?id= selects it). */
export default function CalendarEventsPage() {
  return <MiniCalendar embedded />;
}
