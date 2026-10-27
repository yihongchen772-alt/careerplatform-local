"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MailEventDialog } from "@/components/dashboard/mail-event-dialog";
import { dismissMailDraft, writeMailSchedule } from "@/lib/actions/schedule";
import { rereadMailSchedules } from "@/lib/actions/mail-reread";
import { absoluteWhen, SCHEDULE_KIND_LABELS, kindFromText } from "@/lib/interview-schedule";
import { cn } from "@/lib/utils";

export type PendingMail = {
  id: string;
  /** 「笔试通知」 */
  type: string;
  company: string | null;
  /** The AI's one-line reading of the mail. */
  summary: string;
  subject: string | null;
  draft: unknown;
  /** A time the mail names that is not on the calendar yet. */
  time: { startsAt: string; hasTime: boolean; booking: boolean } | null;
  evidence: string | null;
  booked: boolean;
};

/**
 * 邮件里读到、还没进日历的事: a time that can go on with one click, and the
 * mail that names none (a link to book a slot yourself) with a place to type
 * it in. Everything waiting on the calendar is here, so there is one place to look.
 */
export function PendingMailPanel({ items }: { items: PendingMail[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [rereading, setRereading] = useState(false);
  const shown = items.filter((item) => !hidden.includes(item.id));

  async function reread() {
    if (rereading) return;
    setRereading(true);
    try {
      const result = await rereadMailSchedules();
      if (!result.ok) return void toast.error(result.message);
      const { checked, filled, scheduled, failures } = result.data;
      if (failures.length) toast.error(failures.join("；"));
      else if (!checked) toast.message("没有需要重新读的邮件");
      else if (!filled) toast.message(`重新读了 ${checked} 封邮件，没有找到更多明确的时间`);
      else toast.success(`重新读了 ${checked} 封邮件，补出 ${filled} 个时间${scheduled ? `，${scheduled} 个已写进日历` : ""}`);
      router.refresh();
    } finally {
      setRereading(false);
    }
  }

  async function act(item: PendingMail, run: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) {
    if (busy) return;
    setBusy(item.id);
    try {
      const result = await run();
      if (!result.ok) return void toast.error(result.message);
      setHidden((previous) => [...previous, item.id]);
      toast.success(done);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="邮件里读到、还没进日历的事" className="surface-card rounded-xl p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight"><Mail className="size-4 text-primary" />邮件里的安排，还没进日历{shown.length > 0 && <span className="text-sm font-normal text-muted-foreground">· {shown.length}</span>}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">读到了面试 / 笔试邮件，但时间要你确认或补上。处理完就会从这里消失。</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={rereading} onClick={reread}>
          <RefreshCw className={cn("size-3.5", rereading && "animate-spin")} />{rereading ? "正在读…" : "重新读一遍邮件"}
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">没有待处理的邮件安排。新邮件里的面试、笔试时间会自动写进日历；漏了的，点右上「重新读一遍邮件」。</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((item) => {
            const kind = SCHEDULE_KIND_LABELS[item.time?.booking ? "deadline" : kindFromText(`${item.type} ${item.summary}`)];
            return (
              <li key={item.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/35 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{kind}</span>
                    <span className="min-w-0 truncate">{item.company ?? "（没看出公司）"} · {item.type}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {item.time
                      ? <>邮件里的时间：<span className="font-medium text-foreground">{item.time.booking ? "最晚 " : ""}{absoluteWhen(item.time.startsAt, item.time.hasTime)}{item.time.hasTime ? "" : item.time.booking ? " 前预约" : " 截止"}</span></>
                      : item.booked ? "你已经约好了，但邮件里没写具体时间。到预约页面看一眼，把时间填在这里。" : "邮件里没写具体时间（常见于要你自己点链接约时间的）。约好后把时间填上。"}
                  </p>
                  {item.summary && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.summary}</p>}
                  {item.subject && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80" title={item.subject}>邮件：{item.subject}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {item.time ? (
                    <Button size="sm" disabled={busy === item.id} onClick={() => act(item, () => writeMailSchedule(item.id), "已加入日历")}>加入日历</Button>
                  ) : (
                    <MailEventDialog taskId={item.id} initial={item.draft} label="填时间加入日历" variant="default" onSaved={() => { setHidden((previous) => [...previous, item.id]); router.refresh(); }} />
                  )}
                  <Button size="sm" variant="ghost" disabled={busy === item.id} onClick={() => act(item, () => dismissMailDraft(item.id), "已忽略")}>忽略</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
