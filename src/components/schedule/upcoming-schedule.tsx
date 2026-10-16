"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CalendarClock, CheckCircle2, Link2, Mail, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  SCHEDULE_KIND_LABELS,
  absoluteWhen,
  clashingKeys,
  clock,
  dayLabel,
  itemDayKey,
  relativeText,
  urgencyOf,
  type ScheduleItem,
  type ScheduleKind,
} from "@/lib/interview-schedule";
import { matchApplication } from "@/lib/application-search";
import { attachEventToApplication, dismissMailDraft, writeMailSchedule } from "@/lib/actions/schedule";
import { MeetingActions } from "@/components/schedule/meeting-actions";
import { useNow } from "@/components/schedule/use-now";
import { completeStep } from "@/components/schedule/step-actions";

export type LinkableApplication = { id: string; companyName: string; title: string; aliases?: string[] };

const KIND_STYLE: Record<ScheduleKind, string> = {
  interview: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  exam: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  deadline: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  event: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
};

const URGENCY_TEXT = {
  now: "text-emerald-700 dark:text-emerald-300 font-semibold",
  today: "text-amber-700 dark:text-amber-300 font-medium",
  soon: "text-foreground/80",
  later: "text-muted-foreground",
  past: "text-muted-foreground",
} as const;

/**
 * 接下来: today's and this week's 面试 / 笔试 / 截止 at the top of 投递记录,
 * each one click from its meeting link and its 投递.
 */
export function UpcomingSchedule({ items, now: serverNow, applications, days = 7 }: { items: ScheduleItem[]; now: number; applications: LinkableApplication[]; days?: number }) {
  const now = useNow(serverNow);
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [linking, setLinking] = useState<ScheduleItem | null>(null);
  const visible = items.filter((item) => !hidden.includes(item.key) && urgencyOf(item, now) !== "past");
  // Two booked times on top of each other: say so on both.
  const clashes = useMemo(() => clashingKeys(visible), [visible]);
  const counts = useMemo(() => {
    const result: Partial<Record<ScheduleKind, number>> = {};
    for (const item of visible) result[item.kind] = (result[item.kind] ?? 0) + 1;
    return result;
  }, [visible]);

  if (visible.length === 0) {
    return (
      <section aria-label="接下来的面试和笔试" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-border/80 bg-card/45 px-4 py-3 text-xs text-muted-foreground">
        <CalendarClock className="size-4 text-primary" />
        <span className="font-medium text-foreground">接下来 {days} 天没有面试或笔试安排</span>
        <span>收到邀请后在投递里点「添加面试时间」，或开启邮件扫描自动写入。</span>
      </section>
    );
  }

  const LIMIT = 6;
  const shown = expanded ? visible : visible.slice(0, LIMIT);
  const groups: { key: string; items: ScheduleItem[] }[] = [];
  for (const item of shown) {
    const key = itemDayKey(item);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }

  async function run(item: ScheduleItem, action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) {
    if (busy) return;
    setBusy(item.key);
    try {
      const result = await action();
      if (!result.ok) return void toast.error(result.message);
      setHidden((previous) => [...previous, item.key]);
      toast.success(done);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="接下来的面试和笔试" className="surface-card rounded-xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight"><CalendarClock className="size-4 text-primary" />接下来</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {days} 天内 · {(Object.keys(counts) as ScheduleKind[]).map((kind) => `${SCHEDULE_KIND_LABELS[kind]} ${counts[kind]}`).join(" · ")}
          </p>
        </div>
        <Link href="/calendar" className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">日历视图</Link>
      </div>
      <div className="space-y-3">
        {groups.map((group) => {
          const label = dayLabel(group.key, now);
          return (
            <div key={group.key}>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">{label.day}{label.day.startsWith("周") || ["今天", "明天", "后天", "昨天"].includes(label.day) ? ` · ${label.date}` : ""}</p>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <ScheduleRow
                    key={item.key}
                    item={item}
                    now={now}
                    busy={busy === item.key}
                    clash={clashes.has(item.key)}
                    onComplete={() => { setHidden((previous) => [...previous, item.key]); void completeStep(item.sourceId, () => router.refresh(), `${item.companyName ?? ""} · ${item.title}已完成，开始等结果`).then((ok) => { if (!ok) setHidden((previous) => previous.filter((key) => key !== item.key)); }); }}
                    onWrite={() => run(item, () => writeMailSchedule(item.sourceId), item.applicationId ? `已写进 ${item.companyName ?? "投递"} 的进度和日历` : "已加入日历")}
                    onDismiss={() => run(item, () => dismissMailDraft(item.sourceId), "已忽略这封邮件里的时间")}
                    onLink={() => setLinking(item)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {visible.length > LIMIT && (
        <button type="button" className="mt-3 text-xs font-medium text-primary hover:underline" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : `展开全部 ${visible.length} 项`}
        </button>
      )}
      <LinkDialog
        item={linking}
        applications={applications}
        onClose={() => setLinking(null)}
        onPick={async (app) => {
          const item = linking;
          if (!item) return;
          setLinking(null);
          await run(item, () => attachEventToApplication(item.sourceId, app.id), `已关联到 ${app.companyName} · ${app.title}`);
        }}
      />
    </section>
  );
}

function ScheduleRow({ item, now, busy, clash, onComplete, onWrite, onDismiss, onLink }: { item: ScheduleItem; now: number; busy: boolean; clash: boolean; onComplete: () => void; onWrite: () => void; onDismiss: () => void; onLink: () => void }) {
  const urgency = urgencyOf(item, now);
  const start = new Date(item.startsAt);
  const end = item.endsAt ? new Date(item.endsAt) : null;
  const heading = [item.companyName, item.title].filter(Boolean).join(" · ");
  const detail = [item.jobTitle, item.interviewFormat].filter(Boolean).join(" · ");
  return (
    <li className={cn(
      "flex flex-col gap-2 rounded-xl border bg-background/55 px-3 py-2.5 sm:flex-row sm:items-center",
      urgency === "now" ? "border-emerald-500/40 bg-emerald-500/[0.05]" : urgency === "today" ? "border-amber-500/30" : "border-border/60"
    )}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="w-[5.5rem] shrink-0 pt-0.5">
          <p className="text-sm font-semibold tabular-nums">{item.hasTime ? `${clock(start)}${end ? `–${clock(end)}` : ""}` : item.endsAt ? "窗口" : item.kind === "interview" ? "全天" : "截止"}</p>
          <p className={cn("mt-0.5 text-[11px] leading-4", URGENCY_TEXT[urgency])}>
            {urgency === "now" && <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-emerald-500 align-middle" />}
            {relativeText(item, now)}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", KIND_STYLE[item.kind])}>{SCHEDULE_KIND_LABELS[item.kind]}</span>
            {clash && <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300" title="和另一场安排时间重叠"><TriangleAlert className="size-3" />撞期</span>}
            {item.applicationId ? (
              <Link href={`/applications/${item.applicationId}#interview`} className="truncate font-medium hover:text-primary">{heading}</Link>
            ) : (
              <span className="truncate font-medium">{heading}</span>
            )}
          </p>
          {(detail || item.meetingInfo) && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={[detail, item.meetingInfo].filter(Boolean).join(" · ")}>
              {[detail, item.meetingInfo].filter(Boolean).join(" · ")}
            </p>
          )}
          {item.source === "mail" && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
              <Mail className="size-3" />
              {item.conflictsWith ? `邮件里的时间，和你记录的 ${absoluteWhen(item.conflictsWith)} 不同，还没写入` : "邮件里识别到的时间，还没写入投递和日历"}
            </p>
          )}
          {item.source === "event" && !item.applicationId && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">邮件里的安排，已在日历中；没认出是哪条投递</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-[6.25rem] sm:pl-0">
        <MeetingActions info={item.meetingInfo} compact exam={item.kind === "exam"} />
        {item.source === "mail" ? (
          <>
            <Button type="button" size="sm" className="h-7 rounded-full px-2.5 text-xs" disabled={busy} onClick={onWrite}>{busy ? "写入中…" : "写入日程"}</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={onDismiss}>忽略</Button>
          </>
        ) : item.source === "event" && item.hasTime ? (
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-xs" disabled={busy} onClick={onLink}><Link2 className="size-3.5" />关联投递</Button>
        ) : item.source === "stage" && item.kind === "exam" ? (
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-xs" disabled={busy} onClick={onComplete} title="做完了：不再提醒截止，开始等结果"><CheckCircle2 className="size-3.5" />已完成</Button>
        ) : null}
        {item.applicationId && (
          <Link href={`/applications/${item.applicationId}#interview`} className="inline-flex h-7 items-center gap-0.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`打开 ${heading}`}>
            打开<ArrowUpRight className="size-3.5" />
          </Link>
        )}
      </div>
    </li>
  );
}

function LinkDialog({ item, applications, onClose, onPick }: { item: ScheduleItem | null; applications: LinkableApplication[]; onClose: () => void; onPick: (app: LinkableApplication) => void }) {
  const [query, setQuery] = useState("");
  const term = query.trim();
  // Before typing: the 投递 whose company the invitation's title names.
  const suggested = useMemo(() => {
    if (!item) return [];
    const title = item.title;
    return applications.filter((app) => title.includes(app.companyName) || (app.aliases ?? []).some((alias) => alias && title.includes(alias)));
  }, [item, applications]);
  const results = term
    ? applications.filter((app) => matchApplication({ companyName: app.companyName, aliases: app.aliases, title: app.title }, term))
    : suggested.length ? suggested : applications.slice(0, 8);
  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) { setQuery(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>这个安排属于哪条投递？</DialogTitle>
          <DialogDescription>{item ? `${item.title} · ${absoluteWhen(item.startsAt, item.hasTime)}` : ""}。关联后时间写进那条投递的当前进度，日历和提醒跟着它走。</DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜公司或岗位，拼音首字母也行"
          className="h-9 w-full rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {!term && suggested.length > 0 && <p className="px-1 text-[11px] text-muted-foreground">标题里提到的公司</p>}
          {results.map((app) => (
            <button key={app.id} type="button" onClick={() => { setQuery(""); onPick(app); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
              <span className="font-medium">{app.companyName}</span>
              <span className="text-muted-foreground"> · {app.title}</span>
            </button>
          ))}
          {results.length === 0 && <p className="px-1 py-4 text-center text-sm text-muted-foreground">没有找到，换个关键词试试</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
