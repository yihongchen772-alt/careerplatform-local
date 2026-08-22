import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findStaleApplications, findUpcomingPositionDeadlines } from "@/lib/reminders";
import { sendReminderDigestEmail } from "@/lib/email";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const users = await db.user.findMany({ select: { id: true, email: true } });

  let sent = 0;
  for (const user of users) {
    const [applications, positions] = await Promise.all([
      db.application.findMany({
        where: { userId: user.id },
        include: { company: true },
      }),
      db.position.findMany({
        where: { userId: user.id, status: { not: "APPLIED" } },
        include: { company: true },
      }),
    ]);

    const stale = findStaleApplications(applications);
    const upcoming = findUpcomingPositionDeadlines(positions);

    if (stale.length === 0 && upcoming.length === 0) continue;

    try {
      await sendReminderDigestEmail(user.email, { stale, upcoming });
      sent++;
    } catch (error) {
      console.error(`Failed to send reminder digest to ${user.email}:`, error);
    }
  }

  return NextResponse.json({ usersChecked: users.length, emailsSent: sent });
}
