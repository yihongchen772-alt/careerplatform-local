import { z } from "zod";

/**
 * 心路历程: a diary of the search. A mood, a few lines, and — when it was
 * written because something happened (a rejection, an offer, an interview
 * just done) — a label saying what.
 */
export const MOODS = [
  { key: "happy", emoji: "😊", label: "还不错" },
  { key: "ok", emoji: "😐", label: "一般" },
  { key: "down", emoji: "😟", label: "有点丧" },
  { key: "angry", emoji: "😤", label: "憋屈" },
  { key: "cry", emoji: "🥲", label: "想哭" },
] as const;

export type Mood = (typeof MOODS)[number]["key"];

export const entrySchema = z.object({
  mood: z.enum(["happy", "ok", "down", "angry", "cry"]),
  text: z.string().trim().min(1, "写一两句再保存").max(5000, "太长了，先精简到 5000 字以内"),
  about: z.string().trim().max(80).nullable().optional(),
});

export type JourneyEvent = {
  /** 「星河半导体 · 一面」: what the entry will say it is about. */
  about: string;
  kind: "rejected" | "offer" | "interview";
  /** ISO. */
  at: string;
};

/** The feeling that usually goes with it; only a suggestion the applicant can change. */
export const SUGGESTED_MOOD: Record<JourneyEvent["kind"], Mood> = { rejected: "down", offer: "happy", interview: "ok" };

export const EVENT_WORDS: Record<JourneyEvent["kind"], string> = { rejected: "没通过", offer: "拿到 Offer", interview: "面完" };

/**
 * Events not yet written about: an entry made for the same thing after it
 * happened takes it off the list. Newest first, at most a handful.
 */
export function pendingEvents(events: JourneyEvent[], entries: { about: string | null; createdAt: string }[], limit = 5): JourneyEvent[] {
  return events
    .filter((event) => !entries.some((entry) => entry.about === event.about && entry.createdAt >= event.at))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

/**
 * The one thing worth a nudge on 总览: a result (not an interview) from the
 * last two days that nothing has been written about.
 */
export function nudgeEvent(events: JourneyEvent[], entries: { about: string | null; createdAt: string }[], now: number): JourneyEvent | null {
  const recent = events.filter((event) => event.kind !== "interview" && now - new Date(event.at).getTime() <= 2 * 86_400_000);
  return pendingEvents(recent, entries, 1)[0] ?? null;
}
