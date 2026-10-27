"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveStepNote } from "@/lib/actions/schedule";
import { useNow } from "@/components/schedule/use-now";
import type { JustFinished } from "@/lib/schedule-loader";

const DISMISS_KEY = "careerplatform.recap.dismissed";

// What was dismissed on this device. Read through useSyncExternalStore so the
// server render (nothing dismissed) and the first client render agree.
const noop = () => () => {};
const readStored = () => {
  try { return window.localStorage.getItem(DISMISS_KEY) ?? "[]"; } catch { return "[]"; }
};
function parseStored(raw: string): string[] {
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string").slice(-200) : [];
  } catch {
    return [];
  }
}

function agoText(endedAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(endedAt).getTime()) / 60_000));
  if (minutes < 60) return minutes < 5 ? "刚刚结束" : `${minutes} 分钟前结束`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时前结束` : "昨天结束";
}

/**
 * 刚结束: right after a booked interview (or 笔试) ends, one box to write what
 * was asked while it is fresh. It lands on the step's note, which is what
 * 面经库 reads. Saved, or 「以后再说」, and it is gone; otherwise it goes by
 * itself a day and a half later.
 */
export function JustFinishedStrip({ items, now: serverNow }: { items: JustFinished[]; now: number }) {
  const now = useNow(serverNow);
  const router = useRouter();
  const stored = useSyncExternalStore(noop, readStored, () => "[]");
  const [hiddenNow, setHiddenNow] = useState<string[]>([]);
  const dismissed = [...parseStored(stored), ...hiddenNow];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const shown = items.filter((item) => !dismissed.includes(item.stageHistoryId));
  if (!shown.length) return null;

  function hide(id: string) {
    setHiddenNow((previous) => [...previous, id]);
    try { window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...parseStored(readStored()), id].slice(-200))); } catch {}
  }

  async function save(item: JustFinished) {
    const note = (drafts[item.stageHistoryId] ?? "").trim();
    if (!note) return void toast.error("先写一两句，或者点「以后再说」");
    setBusy(item.stageHistoryId);
    try {
      const result = await saveStepNote(item.stageHistoryId, note);
      if (!result.ok) return void toast.error(result.message);
      toast.success("已记下，面经库里也能看到");
      hide(item.stageHistoryId);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="刚结束的面试" className="surface-card space-y-3 rounded-xl p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight"><PenLine className="size-4 text-primary" />刚结束，趁记得记两句</h2>
      {shown.slice(0, 3).map((item) => {
        const interview = item.kind === "interview";
        const id = `recap-${item.stageHistoryId}`;
        return (
          <div key={item.stageHistoryId} className="space-y-2 rounded-xl border border-border/60 bg-background/35 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-sm font-medium [overflow-wrap:anywhere]">{item.companyName} · {item.round}<span className="ml-1.5 text-xs font-normal text-muted-foreground">{item.jobTitle}</span></p>
              <p className="text-xs text-muted-foreground">{agoText(item.endedAt, now)}</p>
            </div>
            <label htmlFor={id} className="sr-only">{interview ? "问了什么、哪里没答好" : "题型、难度"}</label>
            <Textarea id={id} rows={2} value={drafts[item.stageHistoryId] ?? ""} maxLength={20000} onChange={(event) => setDrafts((previous) => ({ ...previous, [item.stageHistoryId]: event.target.value }))} placeholder={interview ? "问了什么、哪里没答好（会进面经库）" : "题型、难度、没做出来的题（会进面经库）"} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => save(item)}>{busy === item.stageHistoryId ? "保存中…" : "记下来"}</Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => hide(item.stageHistoryId)}>以后再说</Button>
              <Link href={`/applications/${item.applicationId}#interview`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">去详情页写完整的</Link>
            </div>
          </div>
        );
      })}
      {shown.length > 3 && <p className="text-xs text-muted-foreground">还有 {shown.length - 3} 场，先写完这几场就会出现。</p>}
    </section>
  );
}
