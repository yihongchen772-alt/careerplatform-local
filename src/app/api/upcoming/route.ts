import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { loadUpcomingSchedule } from "@/lib/schedule-loader";
import { extractMeetingNumber, extractMeetingUrl, itemDayKey, localDayKey, relativeText, urgencyOf, whenText } from "@/lib/interview-schedule";

/**
 * 接下来, ready to show: the tray menu (Electron main process) and the
 * sidebar badge read this. Loopback-only like every route (src/proxy.ts).
 */
export async function GET(request: Request) {
  const user = await requireUser();
  const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get("days")) || 7, 1), 30);
  const now = new Date();
  const items = (await loadUpcomingSchedule(user.id, now, days)).filter((item) => urgencyOf(item, now.getTime()) !== "past");
  const today = localDayKey(now);
  return NextResponse.json({
    // Booked for today, or due today — not a 测评 window that merely stays open.
    today: items.filter((item) => item.source !== "mail" && (item.hasTime ? itemDayKey(item) === today : (item.endsAt ? item.endsAt.slice(0, 10) : itemDayKey(item)) === today)).length,
    items: items.slice(0, 20).map((item) => {
      const when = whenText(item, now.getTime());
      const who = [item.companyName, item.title].filter(Boolean).join(" · ");
      return {
        key: item.key,
        kind: item.kind,
        source: item.source,
        applicationId: item.applicationId,
        label: `${when} ${who}`,
        relative: relativeText(item, now.getTime()),
        meetingInfo: item.meetingInfo,
        meetingUrl: extractMeetingUrl(item.meetingInfo),
        meetingNumber: extractMeetingNumber(item.meetingInfo),
        startsAt: item.startsAt,
        hasTime: item.hasTime,
      };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}
