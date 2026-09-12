"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncPortalsNow } from "@/lib/actions/application-sync";
import { STAGE_LABELS } from "@/lib/stage-labels";

/**
 * Manual 网申进度同步 from the board itself — the place you're looking at
 * when you wonder "has anything moved?". Hidden until at least one company
 * has a 进度页 set (that's done from the 网申浏览器).
 */
export function PortalSyncButton({ configuredCount }: { configuredCount: number }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  if (configuredCount === 0) return null;

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await syncPortalsNow();
      if (!res.ok) return void toast.error(res.message);
      const { changed, errors, checked } = res.data;
      if (changed.length > 0) {
        toast.success(
          `${changed.length} 条投递阶段已更新：` +
            changed.map((c) => `${c.companyName} ${c.title} ${STAGE_LABELS[c.from]}→${STAGE_LABELS[c.to]}`).join("；")
        );
      } else if (errors.length === 0) {
        toast.info(checked > 0 ? "读了一遍，官网状态和看板一致" : "没有需要检查的投递");
      }
      for (const e of errors) toast.error(`${e.companyName}：${e.message}`);
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={syncing} onClick={handleSync} title={`已为 ${configuredCount} 家公司设了进度页，去官网读一遍最新状态`}>
      <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
      {syncing ? "同步中…" : "同步官网进度"}
    </Button>
  );
}
