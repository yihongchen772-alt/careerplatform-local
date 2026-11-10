"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CalendarClock, CalendarPlus, CheckCircle2, Copy, Link2, Mail, MoreHorizontal, Pencil, Sparkles, TriangleAlert } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ApplicationStage } from "@prisma/client";
import { AddScheduleDialog } from "@/components/calendar/add-schedule-dialog";
import { EditScheduleDialog } from "@/components/schedule/edit-schedule-dialog";
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
  meetingSummary,
  relativeText,
  urgencyOf,
  type ScheduleItem,
  type ScheduleKind,
} from "@/lib/interview-schedule";
import { matchApplication } from "@/lib/application-search";
import { attachEventToApplication, dismissMailDraft, writeMailSchedule } from "@/lib/actions/schedule";
import { MeetingActions, copyMeeting } from "@/components/schedule/meeting-actions";
import { useNow } from "@/components/schedule/use-now";
import { completeEvent, completeStep } from "@/components/schedule/step-actions";
import { KIND_STYLE } from "@/components/schedule/kind-style";

export type LinkableApplication = { id: string; companyName: string; title: string; aliases?: string[]; currentStage: ApplicationStage };

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
  const [editing, setEditing] = useState<ScheduleItem | null>(null);
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
        <span>邮件里的时间会自动写入；没读到的，点这里加。</span>
        <AddScheduleDialog applications={applications.map((app) => ({ ...app, aliases: app.aliases ?? [] }))} trigger={<Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-xs"><CalendarPlus className="size-3.5" />添加面试 / 笔试</Button>} />
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

  async function run<T>(item: ScheduleItem, action: () => Promise<{ ok: true; data: T } | { ok: false; message: string }>, done: string | ((data: T) => string)) {
    if (busy) return;
    setBusy(item.key);
    try {
      const result = await action();
      if (!result.ok) return void toast.error(result.message);
      setHidden((previous) => [...previous, item.key]);
      toast.success(typeof done === "function" ? done(result.data) : done);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="接下来的面试和笔试" className="surface-card rounded-xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tight"><span className="section-chip flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarClock className="size-4" /></span>接下来</h2>
          <p className="mt-1 pl-[2.625rem] text-xs text-muted-foreground">
            {days} 天内 · {(Object.keys(counts) as ScheduleKind[]).map((kind) => `${SCHEDULE_KIND_LABELS[kind]} ${counts[kind]}`).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AddScheduleDialog applications={applications.map((app) => ({ ...app, aliases: app.aliases ?? [] }))} trigger={<Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-xs"><CalendarPlus className="size-3.5" />添加面试 / 笔试</Button>} />
          <Link href="/calendar" className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">日历视图</Link>
        </div>
      </div>
      <div className="space-y-3">
        {groups.map((group) => {
          const label = dayLabel(group.key, now);
          return (
            <div key={group.key}>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground">{label.day}{label.day.startsWith("周") || ["今天", "明天", "后天", "昨天"].includes(label.day) ? ` · ${label.date}` : ""}</p>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <ScheduleRow
                    key={item.key}
                    item={item}
                    now={now}
                    busy={busy === item.key}
                    clash={clashes.has(item.key)}
                    onComplete={() => {
                      setHidden((previous) => [...previous, item.key]);
                      const label = [item.companyName, item.title].filter(Boolean).join(" · ");
                      // Undoing brings the row back, so it must not stay in the hidden list.
                      const unhide = () => setHidden((previous) => previous.filter((key) => key !== item.key));
                      const finished = item.source === "event"
                        ? completeEvent(item.sourceId, () => router.refresh(), `${label}已完成`, unhide)
                        : completeStep(item.sourceId, () => router.refresh(), `${label}${item.kind === "interview" && new Date(item.startsAt).getTime() <= now ? "已面完" : "已完成"}，开始等结果`, unhide);
                      void finished.then((ok) => { if (!ok) setHidden((previous) => previous.filter((key) => key !== item.key)); });
                    }}
                    onWrite={() => run(item, () => writeMailSchedule(item.sourceId), (written) => (written.placed === "stage" ? `已写进 ${item.companyName ?? "投递"} 的进度和日历` : "已加入日历"))}
                    onDismiss={() => run(item, () => dismissMailDraft(item.sourceId), "已忽略这封邮件里的时间")}
                    onLink={() => setLinking(item)}
                    onAccept={() => item.suggestion && run(item, () => attachEventToApplication(item.sourceId, item.suggestion!.applicationId), `已关联到 ${item.suggestion.label}`)}
                    onEdit={() => setEditing(item)}
                    onCancelNoticeSeen={() => { if (item.cancelNotice) void dismissMailDraft(item.cancelNotice.taskId).then(() => router.refresh()); }}
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
      <EditScheduleDialog item={editing} applications={applications} onClose={() => setEditing(null)} />
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

function ScheduleRow({ item, now, busy, clash, onComplete, onWrite, onDismiss, onLink, onAccept, onEdit, onCancelNoticeSeen }: { item: ScheduleItem; now: number; busy: boolean; clash: boolean; onComplete: () => void; onWrite: () => void; onDismiss: () => void; onLink: () => void; onAccept: () => void; onEdit: () => void; onCancelNoticeSeen: () => void }) {
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
          <p className={cn("mt-0.5 text-xs leading-4", URGENCY_TEXT[urgency])}>
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
              {[detail, meetingSummary(item.meetingInfo, item.kind === "exam")].filter(Boolean).join(" · ")}
            </p>
          )}
          {item.cancelNotice && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-300" title={item.cancelNotice.subject}>
              <TriangleAlert className="size-3 shrink-0" />
              <span className="truncate">公司发过取消通知「{item.cancelNotice.subject}」，确认后在「⋯」里清掉或删除</span>
              <button type="button" disabled={busy} onClick={onCancelNoticeSeen} className="shrink-0 font-medium underline-offset-2 hover:underline">知道了</button>
            </p>
          )}
          {item.source === "mail" && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
              <Mail className="size-3" />
              {item.conflictsWith ? `邮件里的时间，和你记录的 ${absoluteWhen(item.conflictsWith)} 不同，还没写入` : "邮件里识别到的时间，还没写入投递和日历"}
            </p>
          )}
          {item.source === "event" && !item.applicationId && (
            item.suggestion ? (
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles className="size-3 text-primary" />
                <span>像是「{item.suggestion.label}」的安排</span>
                <button type="button" disabled={busy} onClick={onAccept} className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50">{busy ? "关联中…" : "是，关联"}</button>
              </p>
            ) : item.companyName && item.companyApplications ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{item.companyName} 有 {item.companyApplications} 条进行中的投递，点「关联投递」选是哪一条</p>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">{item.fromMail ? "邮件里的安排，已在日历中；没认出是哪条投递" : "你自己加的日程，不属于任何投递"}</p>
            )
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-[6.25rem] sm:pl-0">
        <MeetingActions info={item.meetingInfo} compact exam={item.kind === "exam"} copy={false} />
        {item.source === "mail" ? (
          <>
            <Button type="button" size="sm" className="h-7 rounded-full px-2.5 text-xs" disabled={busy} onClick={onWrite}>{busy ? "写入中…" : "写入日程"}</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={onDismiss}>忽略</Button>
          </>
        ) : item.source === "event" ? (
          <>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-xs" disabled={busy} onClick={onComplete} title="做完了：从「接下来」拿掉，也不再提醒"><CheckCircle2 className="size-3.5" />已完成</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 rounded-full px-2 text-xs text-muted-foreground" disabled={busy} onClick={onLink}><Link2 className="size-3.5" />关联投递</Button>
          </>
        ) : item.source === "stage" ? (
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-xs" disabled={busy} onClick={onComplete} title={item.kind === "interview" ? "面完了：开始等结果，趁记得写两句" : "做完了：不再提醒截止，开始等结果"}><CheckCircle2 className="size-3.5" />{item.kind === "interview" && start.getTime() <= now ? "已面完" : "已完成"}</Button>
        ) : null}
        {/* Copy, edit and open sit behind 「⋯」: the row keeps one main action. */}
        {(item.meetingInfo || item.source !== "mail" || item.applicationId) && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" size="sm" variant="ghost" className="size-7 rounded-full p-0 text-muted-foreground" disabled={busy} aria-label={`${heading} 的更多操作`} title="复制、修改、打开投递" />}>
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {item.meetingInfo && <DropdownMenuItem onClick={() => copyMeeting(item.meetingInfo!)}><Copy />复制{/(?:会议号|会议 ?ID|Meeting ID|入会码)/i.test(item.meetingInfo) ? "会议号" : "链接"}</DropdownMenuItem>}
              {item.source !== "mail" && <DropdownMenuItem onClick={onEdit}><Pencil />修改时间、链接和提醒</DropdownMenuItem>}
              {item.applicationId && <DropdownMenuItem render={<Link href={`/applications/${item.applicationId}#interview`} />}><ArrowUpRight />打开这条投递</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
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
    // 接下来 already named the company (and dropped it from the title).
    if (item.companyName) return applications.filter((app) => app.companyName === item.companyName);
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
          <DialogDescription>{item ? `${[item.companyName, item.title].filter(Boolean).join(" · ")} · ${absoluteWhen(item.startsAt, item.hasTime)}` : ""}。关联后{item?.hasTime ? "时间写进那条投递的当前进度，日历和提醒跟着它走" : "这个截止日写进那条投递的当前进度，日历跟着它走"}。</DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜公司或岗位，拼音首字母也行"
          className="h-9 w-full rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {!term && suggested.length > 0 && <p className="px-1 text-xs text-muted-foreground">{item?.companyName ? `${item.companyName} 的投递` : "标题里提到的公司"}</p>}
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
