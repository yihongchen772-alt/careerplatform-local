import { NotebookPen } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PageHero } from "@/components/layout/page-hero";
import { JourneyBoard } from "@/components/journey/journey-board";
import { currentTimeMs } from "@/lib/dates";
import { loadJourneyEvents } from "@/lib/journey-loader";
import { pendingEvents, SUGGESTED_MOOD } from "@/lib/journey";

export default async function JourneyPage({ searchParams }: { searchParams: Promise<{ about?: string }> }) {
  const user = await requireUser();
  const { about } = await searchParams;
  const now = currentTimeMs();
  const [entries, events] = await Promise.all([
    db.journeyEntry.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 300 }),
    loadJourneyEvents(user.id, now),
  ]);
  const rows = entries.map((entry) => ({ id: entry.id, mood: entry.mood, text: entry.text, about: entry.about, createdAt: entry.createdAt.toISOString() }));
  const open = pendingEvents(events, rows);
  // Coming from 总览's nudge: that event is already chosen, with its usual mood.
  const chosen = about ? open.find((event) => event.about === about) ?? null : null;
  return (
    <div className="space-y-6">
      <PageHero title="心路历程" icon={NotebookPen} description="秋招又长又熬，把心情记下来。写给自己看的日记，不打分，也不分析。" />
      <JourneyBoard entries={rows} events={open} initial={chosen ? { about: chosen.about, mood: SUGGESTED_MOOD[chosen.kind] } : null} />
    </div>
  );
}
