"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveApplicationJd } from "@/lib/actions/application-jd";

/** The 岗位 JD kept with this 投递 — read off the job page when it was recorded; pasteable when it could not be. */
export function ApplicationJdCard({ applicationId, text, url }: { applicationId: string; text: string; url: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(text); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); const r = await saveApplicationJd({ applicationId, text: draft, url: url || undefined }); setBusy(false);
    if (!r.ok) { toast.error(r.message); return; }
    toast.success(draft.trim() ? "JD 已保存" : "JD 已清空"); setEditing(false); router.refresh();
  }
  return <Card><CardHeader><CardTitle>岗位 JD</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    {editing ? <>
      <textarea aria-label="岗位 JD" className="min-h-64 w-full rounded border bg-background p-2 text-sm" value={draft} maxLength={20000} onChange={(e) => setDraft(e.target.value)} placeholder="把岗位职责、任职要求粘贴到这里" />
      <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={save}>保存</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { setDraft(text); setEditing(false); }}>取消</Button></div>
    </> : text ? <>
      <details open><summary className="cursor-pointer text-muted-foreground">投递时保存的岗位描述（{text.length} 字）</summary><p className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap">{text}</p></details>
      <div className="flex flex-wrap items-center gap-3">{url && <a href={url} target="_blank" rel="noreferrer" className="text-primary underline">打开原岗位页面</a>}<Button size="sm" variant="outline" onClick={() => { setDraft(text); setEditing(true); }}>编辑</Button></div>
    </> : <>
      <p className="text-muted-foreground">投递时没有读到这个岗位的 JD。岗位页面可能下线，建议现在粘贴保存一份。</p>
      <Button size="sm" variant="outline" onClick={() => { setDraft(""); setEditing(true); }}>粘贴 JD</Button>
    </>}
  </CardContent></Card>;
}
