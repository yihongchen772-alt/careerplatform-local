import { Mail, CheckCircle2, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MeetingActions } from "@/components/schedule/meeting-actions";
import { mailDraftMeta } from "@/lib/mail-time";

export type ApplicationMailItem = {
  id: string;
  title: string;
  note: string | null;
  dueDate: Date | null;
  mailEventDraft: unknown;
  mailEventId: string | null;
  mailAppliedAt: Date | null;
  done: boolean;
  createdAt: Date;
};

/**
 * Displays every recognized email task attached to this application so applicants
 * can trace original subject, entrance links, passcodes, and action deadlines in one card.
 */
export function ApplicationMailTimeline({ items }: { items: ApplicationMailItem[] }) {
  return (
    <Card id="mail-timeline" className="scroll-mt-20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Mail className="size-4 text-primary" />
          关联邮件动态
          {items.length > 0 && <span className="text-xs font-normal text-muted-foreground">· {items.length} 封</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无自动关联到这条投递的邮件记录。</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => {
              const lines = (item.note ?? "").split("\n").map((l) => l.trim());
              const summary = lines[0] && !/^(?:邮件主题|来自|收件箱|待办|口令)[：:]/.test(lines[0]) ? lines[0] : "";
              const subject = lines.find((l) => l.startsWith("邮件主题："))?.slice(5).trim() ?? "";
              const from = lines.find((l) => l.startsWith("来自："))?.slice(3).trim() ?? "";
              const mailbox = lines.find((l) => l.startsWith("收件箱："))?.slice(4).trim() ?? "";
              const meta = mailDraftMeta(item.mailEventDraft, item.note);
              const scheduled = Boolean(item.mailAppliedAt || item.mailEventId);

              return (
                <li key={item.id} className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{item.title}</span>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      {scheduled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          <CalendarClock className="size-3" />已写进日历
                        </span>
                      ) : item.done ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <CheckCircle2 className="size-3" />已处理
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          待处理
                        </span>
                      )}
                      <span>{new Date(item.createdAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span>
                    </div>
                  </div>
                  {summary && <p className="mt-1 text-foreground/90 [overflow-wrap:anywhere]">{summary}</p>}
                  {subject && <p className="mt-0.5 truncate text-muted-foreground" title={subject}>主题：{subject}</p>}
                  {(from || mailbox) && (
                    <p className="mt-0.5 truncate text-muted-foreground/80">
                      {[from && `发件人：${from}`, mailbox && `收件箱：${mailbox}`].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {(meta.actionRequired || item.dueDate) && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {meta.actionRequired && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          待办：{meta.actionRequired}
                        </span>
                      )}
                      {item.dueDate && (
                        <span className="text-muted-foreground">
                          截止 {new Date(item.dueDate).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}
                        </span>
                      )}
                    </p>
                  )}
                  {meta.meetingInfo && (
                    <div className="mt-1.5">
                      <MeetingActions info={meta.meetingInfo} compact />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
