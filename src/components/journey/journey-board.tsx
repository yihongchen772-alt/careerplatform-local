"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { Textarea } from "@/components/ui/textarea";
import { addJourneyEntry, deleteJourneyEntry } from "@/lib/actions/journey";
import { EVENT_WORDS, MOODS, SUGGESTED_MOOD, type JourneyEvent, type Mood } from "@/lib/journey";
import { cn } from "@/lib/utils";

export type JourneyRow = { id: string; mood: string; text: string; about: string | null; createdAt: string };

const EMOJI: Record<string, string> = Object.fromEntries(MOODS.map((mood) => [mood.key, mood.emoji]));

function when(iso: string): string {
  const date = new Date(iso);
  const weekday = "日一二三四五六"[date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日 周${weekday} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * 心路历程: write how it feels, pick a mood. What just happened (a result, an
 * interview that ended) is offered as a one-click starting point, with the
 * mood that usually goes with it already chosen.
 */
export function JourneyBoard({ entries, events, initial }: { entries: JourneyRow[]; events: JourneyEvent[]; initial: { about: string | null; mood: Mood } | null }) {
  const router = useRouter();
  const [mood, setMood] = useState<Mood>(initial?.mood ?? "ok");
  const [about, setAbout] = useState<string | null>(initial?.about ?? null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  function pick(event: JourneyEvent) {
    setAbout(event.about);
    setMood(SUGGESTED_MOOD[event.kind]);
  }

  async function save() {
    setBusy(true);
    try {
      const result = await addJourneyEntry({ mood, text, about });
      if (!result.ok) return void toast.error(result.message);
      setText("");
      setAbout(null);
      toast.success("记下了");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="surface-card rounded-xl">
        <CardContent className="space-y-3 pt-5">
          {events.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">最近发生的，点一下可以写写它：</p>
              <div className="flex flex-wrap gap-1.5">
                {events.map((event) => (
                  <button key={`${event.about}|${event.at}`} type="button" onClick={() => pick(event)} className={cn("rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted", about === event.about && "border-primary bg-primary/10 text-primary")}>
                    {event.about.split(" · ")[0]} {EVENT_WORDS[event.kind]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {about && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              关于：<span className="font-medium text-foreground">{about}</span>
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => setAbout(null)}>不关联</button>
            </p>
          )}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="心情">
            {MOODS.map((item) => (
              <button key={item.key} type="button" role="radio" aria-checked={mood === item.key} onClick={() => setMood(item.key)} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-muted", mood === item.key && "border-primary bg-primary/10 font-medium text-primary")}>
                <span className="text-base">{item.emoji}</span>{item.label}
              </button>
            ))}
          </div>
          <label htmlFor="journey-text" className="sr-only">今天怎么样</label>
          <Textarea id="journey-text" rows={4} value={text} maxLength={5000} onChange={(event) => setText(event.target.value)} placeholder="今天怎么样？不用写得好，写给自己看。" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">只存在这台电脑上，不会发给任何人，也不会发给 AI。</p>
            <Button onClick={save} disabled={busy || !text.trim()}>{busy ? "保存中…" : "记下来"}</Button>
          </div>
        </CardContent>
      </Card>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          秋招很长，偶尔把心情记下来，回头看会知道自己走了多远。
        </div>
      ) : (
        <ol className="space-y-3 border-l pl-5">
          {entries.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -left-[2.05rem] top-0 flex size-7 items-center justify-center rounded-full border bg-background text-base" title={MOODS.find((item) => item.key === entry.mood)?.label}>{EMOJI[entry.mood] ?? "·"}</span>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs text-muted-foreground">{when(entry.createdAt)}{entry.about ? ` · ${entry.about}` : ""}</p>
                <ConfirmDeleteButton
                  trigger={<Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground">删除</Button>}
                  title="删除这条记录？"
                  description="删除后找不回来。"
                  onConfirm={async () => {
                    const result = await deleteJourneyEntry(entry.id);
                    if (!result.ok) toast.error(result.message);
                    else router.refresh();
                  }}
                />
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{entry.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
