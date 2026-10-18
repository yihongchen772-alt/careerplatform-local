"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { dismissProfileInference, runProfileInference, undoProfileInference } from "@/lib/actions/agent-profile";
import type { InferredRecord } from "@/lib/agent/infer-profile";

const LABELS: Record<string, string> = { targetTrack: "求职方向", preferredCities: "期望城市", skills: "擅长技能" };

/**
 * 「小欧根据你的投递补上了求职方向…」: written once when 总览 opens with
 * those blank, shown until closed, with 撤销 and a link to edit them.
 */
export function InferredProfileBanner({ due, initial }: { due: boolean; initial: InferredRecord | null }) {
  const router = useRouter();
  const [record, setRecord] = useState(initial);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!due || started.current) return;
    started.current = true;
    void runProfileInference().then((res) => {
      if (res.ok && res.data && !res.data.seen) { setRecord(res.data); router.refresh(); }
    });
  }, [due, router]);

  if (!record) return null;
  const fields = Object.entries(record.fields);
  const close = () => { setRecord(null); void dismissProfileInference(); };

  async function undo() {
    setBusy(true);
    const res = await undoProfileInference();
    setBusy(false);
    if (!res.ok) return void toast.error(res.message);
    toast.success(res.data.kept ? `已撤销；${res.data.kept} 项你之后改过，保留不动` : "已撤销，这些资料回到空白");
    setRecord(null);
    router.refresh();
  }

  return (
    <div role="status" className="surface-card flex items-start gap-3 rounded-2xl px-4 py-3 text-sm">
      <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-500" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium">小欧根据你的投递和简历，补上了你没填的资料，之后的建议和岗位匹配会按这个来</p>
        {fields.map(([key, value]) => <p key={key} className="truncate text-xs text-muted-foreground" title={value}>{LABELS[key] ?? key}：{value}</p>)}
        {!!record.memoryIds.length && <p className="text-xs text-muted-foreground">另记住了 {record.memoryIds.length} 条你的求职情况（小欧 → 记忆里能看）</p>}
      </div>
      <Link href="/settings" className={buttonVariants({ size: "sm", variant: "ghost" })}>去改</Link>
      <Button size="sm" variant="outline" disabled={busy} onClick={undo}>撤销</Button>
      <button type="button" aria-label="关闭" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={close}><X className="size-4" /></button>
    </div>
  );
}
