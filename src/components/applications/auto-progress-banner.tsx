"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Radar, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationStage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { dismissAutoStageUpdates, undoAutoStageUpdate } from "@/lib/actions/auto-progress";

export type AutoProgressItem = {
  id: string;
  applicationId: string;
  companyName: string;
  title: string;
  stage: ApplicationStage;
  stageLabel: string | null;
  source: string;
  evidence: string | null;
  enteredAt: string;
};

/**
 * Recognised email/portal updates are already applied; this is where the
 * user sees what changed and takes back anything that was misread.
 */
export function AutoProgressBanner({ items, showApplication = true }: { items: AutoProgressItem[]; showApplication?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [handled, setHandled] = useState<string[]>([]);
  const visible = items.filter((item) => !handled.includes(item.id));
  if (visible.length === 0) return null;

  async function undo(item: AutoProgressItem) {
    if (busy) return;
    setBusy(item.id);
    try {
      const result = await undoAutoStageUpdate(item.id);
      if (!result.ok) return void toast.error(result.message);
      setHandled((previous) => [...previous, item.id]);
      toast.success(`已撤销，${item.companyName} 回到之前的进度`);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(ids: string[]) {
    if (busy) return;
    setBusy("all");
    try {
      const result = await dismissAutoStageUpdates(ids);
      if (!result.ok) return void toast.error(result.message);
      setHandled((previous) => [...previous, ...ids]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[1.4rem] border border-primary/25 bg-primary/[0.04] p-4 sm:p-5" aria-label="自动更新的进度">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Sparkles className="size-4" />已自动更新 {visible.length} 条进度</div>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/settings#auto-progress" className="text-muted-foreground hover:text-foreground hover:underline">自动更新设置</Link>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => dismiss(visible.map((item) => item.id))}>全部知道了</Button>
        </div>
      </div>
      <div className="space-y-2">
        {visible.map((item) => {
          const Icon = item.source === "email" ? Mail : Radar;
          return (
            <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm">
                    {showApplication && <><Link href={`/applications/${item.applicationId}`} className="font-medium hover:text-primary">{item.companyName} · {item.title}</Link><span className="text-muted-foreground"> → </span></>}
                    <span className="font-medium">{STAGE_LABELS[item.stage]}</span>
                    {item.stageLabel && item.stageLabel !== STAGE_LABELS[item.stage] && <span className="text-muted-foreground">（{item.stageLabel}）</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={item.evidence ?? undefined}>
                    {item.source === "email" ? "来自邮件" : "来自官网"}{item.evidence ? `：${item.evidence}` : ""} · {new Date(item.enteredAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => dismiss([item.id])}>没问题</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => undo(item)}>{busy === item.id ? "撤销中…" : "撤销"}</Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
