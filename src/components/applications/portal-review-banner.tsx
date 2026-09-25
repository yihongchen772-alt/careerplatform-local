"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import type { ApplicationStage } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { resolvePortalStageSuggestion } from "@/lib/actions/application-sync";

export type PortalReviewItem = {
  id: string;
  companyName: string;
  title: string;
  currentStage: ApplicationStage;
  suggestedStage: ApplicationStage;
  portalStatus: string | null;
};

export function PortalReviewBanner({ items }: { items: PortalReviewItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [handled, setHandled] = useState<string[]>([]);
  const visible = items.filter((item) => !handled.includes(item.id));
  if (visible.length === 0) return null;

  async function resolve(id: string, accept: boolean) {
    if (busy) return;
    setBusy(id);
    try {
      const result = await resolvePortalStageSuggestion(id, accept);
      if (!result.ok) return void toast.error(result.message);
      setHandled((previous) => [...previous, id]);
      toast.success(accept ? "已确认官网进度" : "已忽略这条官网建议");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[1.4rem] border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5" aria-label="官网进度待核对">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300"><AlertCircle className="size-4" />{visible.some((item) => item.suggestedStage === "REJECTED") ? "官网提示有投递未通过，待你核对" : "官网进度待核对"} · {visible.length}</div>
      <div className="space-y-2">
        {visible.map((item) => (
          <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Link href={`/applications/${item.id}`} className="text-sm font-medium hover:text-primary">{item.companyName} · {item.title}</Link>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">官网显示「{item.portalStatus ?? STAGE_LABELS[item.suggestedStage]}」，建议从{STAGE_LABELS[item.currentStage]}改为{STAGE_LABELS[item.suggestedStage]}。企业流程可能不同，请核对后再确认；确认前不会更改阶段。</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy === item.id} onClick={() => resolve(item.id, false)}>忽略</Button>
              <Button type="button" size="sm" disabled={busy === item.id} onClick={() => resolve(item.id, true)}>{busy === item.id ? "处理中…" : "确认更新"}</Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
