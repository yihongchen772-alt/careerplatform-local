"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { mailEventDraftSchema, type MailEventDraft } from "@/lib/mail-calendar";
import { confirmMailCalendar, mailLinkChoices } from "@/lib/actions/mail-calendar";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";

type Choices = { applicationId: string | null; applications: { id: string; label: string; stage: string }[]; stages: { value: string; label: string }[] };
const FIELD = "mt-1 h-8";
const LABEL = "block text-xs font-medium text-muted-foreground";

export function MailEventDialog({ taskId, initial, eventId, label = "核对邮件日程", variant = "outline", onSaved }: { taskId: string; initial: unknown; eventId?: string | null; label?: string; variant?: "outline" | "default"; onSaved?: () => void }) {
  // Mail seldom names a timezone; an invitation to you is in your own time.
  const parsed = mailEventDraftSchema.safeParse(initial); const [draft, setDraft] = useState(() => { const value = parsed.success ? parsed.data : mailEventDraftSchema.parse({}); const start = value.localStart || (/^\d{4}-\d{2}-\d{2}/.test(value.deadline) ? `${value.deadline.slice(0, 10)}T${/T(?!24)\d{2}:\d{2}/.test(value.deadline) ? value.deadline.slice(11, 16) : "23:59"}` : ""); return { ...value, localStart: start, timeZone: value.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone }; });
  // A time read from the mail is checked against it; one the user types is its own confirmation.
  const [needsCheck] = useState(() => !!(parsed.success && (parsed.data.localStart || parsed.data.deadline)));
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [offset, setOffset] = useState(30); const [confirmed, setConfirmed] = useState(false); const [saved, setSaved] = useState(eventId || ""); const [typed, setTyped] = useState(false);
  // Which 投递 and which step: loaded when the dialog opens; "" = as the mail was matched.
  const [choices, setChoices] = useState<Choices | null>(null); const [applicationId, setApplicationId] = useState<string | null>(null); const [stage, setStage] = useState(""); const [linkTouched, setLinkTouched] = useState(false);
  function patch(value: Partial<MailEventDraft>) { setDraft((d) => ({ ...d, ...value })); setConfirmed(false); if (value.localStart !== undefined || value.localEnd !== undefined) setTyped(true); }
  function changeOpen(next: boolean) {
    setOpen(next);
    if (next && !choices) void mailLinkChoices(taskId).then((r) => { if (r.ok) { setChoices(r.data); setApplicationId((current) => (linkTouched ? current : r.data.applicationId)); } });
  }
  async function save() {
    setBusy(true);
    // Untouched, the mail's own match and the round its text names decide, as before.
    const link = linkTouched ? { applicationId, stage: applicationId && stage ? stage : null } : undefined;
    const r = await confirmMailCalendar(taskId, { ...draft, booking: false }, offset, link);
    setBusy(false);
    if (r.ok) { setSaved(r.data.id); setOpen(false); toast.success(r.data.applicationId ? "已加到这条投递的进度、日历和「接下来」，邮件待办已标记完成" : "已加入日历和「接下来」，邮件待办已标记完成"); onSaved?.(); } else toast.error(r.message);
  }
  if (saved) return <a href={`/api/calendar-export?eventId=${encodeURIComponent(saved)}`} className="text-xs text-primary underline">已加入日历 · 导出 ICS</a>;
  const linked = choices?.applications.find((app) => app.id === applicationId);
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger render={<Button size="sm" variant={variant}>{label}</Button>} /><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>核对后加到日历和「接下来」</DialogTitle></DialogHeader>
    <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">邮件依据：{draft.evidence || "邮件里没有明确时间。约好后把日期和时间填在下面；只知道截止日的，填截止那天 23:59 即可。"}</p>
    <div className="space-y-3">
      <label className={LABEL}>标题<Input className={FIELD} placeholder="例如：某公司 一面" value={draft.title} onChange={(e) => patch({ title: e.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>开始时间<Input type="datetime-local" className={FIELD} value={draft.localStart} onChange={(e) => patch({ localStart: e.target.value })} /></label>
        <label className={LABEL}>结束时间（可空）<Input type="datetime-local" className={FIELD} value={draft.localEnd} onChange={(e) => patch({ localEnd: e.target.value })} /></label>
      </div>
      <label className={LABEL}>这是哪条投递的事
        <NativeSelect className={FIELD} disabled={!choices} value={applicationId ?? ""} onChange={(e) => { setApplicationId(e.target.value || null); setLinkTouched(true); }}>
          <option value="">{choices ? "不关联投递（单独一条日程）" : "正在读取投递…"}</option>
          {choices?.applications.map((app) => <option key={app.id} value={app.id}>{app.label}（{app.stage}）</option>)}
        </NativeSelect>
        <span className="mt-1 block font-normal">{linked ? "时间会记在这条投递的进度上，投递、日历、「接下来」三处一起显示；以后这家公司的邮件也会认到它。" : "邮件没认出是哪条投递时在这里选一下；不选也能加，只是不会更新投递进度。"}</span>
      </label>
      {linked && <label className={LABEL}>放到哪一步
        <NativeSelect className={FIELD} value={stage} onChange={(e) => { setStage(e.target.value); setLinkTouched(true); }}>
          <option value="">自动判断（按邮件和标题里写的轮次）</option>
          {choices?.stages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </NativeSelect>
      </label>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={LABEL}>地点<Input className={FIELD} value={draft.location} onChange={(e) => patch({ location: e.target.value })} /></label>
        <label className={LABEL}>会议 / 笔试链接<Input className={FIELD} placeholder="https://…" value={draft.meetingUrl} onChange={(e) => patch({ meetingUrl: e.target.value })} /></label>
        <label className={LABEL}>时区<Input placeholder="例如 Asia/Shanghai、Asia/Singapore 或 UTC" className={FIELD} value={draft.timeZone} onChange={(e) => patch({ timeZone: e.target.value })} list={`zones-${taskId}`} /><datalist id={`zones-${taskId}`}>{["Asia/Shanghai", "Asia/Singapore", "Asia/Hong_Kong", "UTC", "America/New_York", "Europe/London"].map((z) => <option key={z} value={z} />)}</datalist></label>
        <label className={LABEL}>提前提醒<NativeSelect className={FIELD} value={offset} onChange={(e) => setOffset(Number(e.target.value))}>{[[0, "到点提醒"], [15, "提前 15 分钟"], [30, "提前 30 分钟"], [60, "提前 1 小时"], [1440, "提前 1 天"]].map(([n, text]) => <option key={n} value={n}>{text}</option>)}</NativeSelect></label>
      </div>
    </div>
    {needsCheck && !typed && <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我已核对原邮件的日期、时区和会议安排</label>}
    <Button disabled={busy || !draft.localStart || (needsCheck && !typed && !confirmed)} onClick={save}>{busy ? "正在加入…" : "确认加入"}</Button>
  </DialogContent></Dialog>;
}
