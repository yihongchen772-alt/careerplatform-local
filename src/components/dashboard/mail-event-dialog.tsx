"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { mailEventDraftSchema, type MailEventDraft } from "@/lib/mail-calendar";
import { confirmMailCalendar } from "@/lib/actions/mail-calendar";
export function MailEventDialog({ taskId, initial, eventId }: { taskId: string; initial: unknown; eventId?: string | null }) {
  const parsed = mailEventDraftSchema.safeParse(initial); const [draft, setDraft] = useState(parsed.success ? parsed.data : mailEventDraftSchema.parse({}));
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [offset, setOffset] = useState(30); const [confirmed, setConfirmed] = useState(false); const [saved, setSaved] = useState(eventId || "");
  function patch(value: Partial<MailEventDraft>) { setDraft((d) => ({ ...d, ...value })); setConfirmed(false); }
  if (saved) return <a href={`/api/calendar-export?eventId=${encodeURIComponent(saved)}`} className="text-xs text-primary underline">已加入日历 · 导出 ICS</a>;
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button size="sm" variant="outline">核对邮件日程</Button>} /><DialogContent><DialogHeader><DialogTitle>确认面试 / 笔试安排</DialogTitle></DialogHeader>
    <p className="whitespace-pre-wrap text-xs text-muted-foreground">邮件依据：{draft.evidence || "未识别明确时间，请对照原邮件填写"}</p>
    <label>标题<input className="w-full rounded border bg-background p-2" value={draft.title} onChange={(e) => patch({ title: e.target.value })} /></label>
    <label>开始时间<input type="datetime-local" className="w-full rounded border bg-background p-2" value={draft.localStart} onChange={(e) => patch({ localStart: e.target.value })} /></label>
    <label>结束时间（可空）<input type="datetime-local" className="w-full rounded border bg-background p-2" value={draft.localEnd} onChange={(e) => patch({ localEnd: e.target.value })} /></label>
    <label>时区<input placeholder="例如 Asia/Shanghai、Asia/Singapore 或 UTC" className="w-full rounded border bg-background p-2" value={draft.timeZone} onChange={(e) => patch({ timeZone: e.target.value })} list={`zones-${taskId}`} /><datalist id={`zones-${taskId}`}>{["Asia/Shanghai", "Asia/Singapore", "Asia/Hong_Kong", "UTC", "America/New_York", "Europe/London"].map((z) => <option key={z} value={z} />)}</datalist></label>
    <label>地点<input className="w-full rounded border bg-background p-2" value={draft.location} onChange={(e) => patch({ location: e.target.value })} /></label><label>会议链接<input className="w-full rounded border bg-background p-2" value={draft.meetingUrl} onChange={(e) => patch({ meetingUrl: e.target.value })} /></label>
    <label>提前提醒<select className="ml-2 rounded border bg-background p-1" value={offset} onChange={(e) => setOffset(Number(e.target.value))}>{[0, 15, 30, 60, 1440].map((n) => <option key={n} value={n}>{n} 分钟</option>)}</select></label>
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我已核对原邮件的日期、时区和会议安排</label>
    <Button disabled={busy || !confirmed} onClick={async () => { setBusy(true); const r = await confirmMailCalendar(taskId, draft, offset); setBusy(false); if (r.ok) { setSaved(r.data.id); setOpen(false); toast.success("已加入日历，邮件待办已标记完成"); } else toast.error(r.message); }}>确认加入日历</Button>
  </DialogContent></Dialog>;
}
