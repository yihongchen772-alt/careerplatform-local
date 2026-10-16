"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { scanInboxNow } from "@/lib/actions/inbox-scan";

/**
 * 「自动读邮件停了」: the background inbox scan has failed twice in a row.
 * Otherwise nothing would say so — mail just stops turning into 进度 and
 * 面试时间. Gone as soon as a scan works again.
 */
export function ScanHealthBanner({ error, since, lastOkAt }: { error: string | null; since: string | null; lastOkAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const day = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <MailWarning className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium">自动读邮件停了{since ? `（从 ${day(since)} 起）` : ""}，新的面试、笔试通知不会自动记进来</p>
        {error && <p className="text-muted-foreground">原因：{error}</p>}
        <p className="text-xs text-muted-foreground">{lastOkAt ? `上次成功：${day(lastOkAt)}。` : ""}修好后会接着从上次读到的地方读，不会漏邮件。</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await scanInboxNow();
              if (!result.ok) toast.error(result.message);
              else if (result.data.failures.length) toast.error(result.data.failures.join("；"));
              else toast.success(`好了，读了 ${result.data.scanned} 封新邮件`);
              router.refresh();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "正在重试…" : "重试"}
        </Button>
        <Link href="/settings?tab=mail#mail-accounts" className={buttonVariants({ size: "sm" })}>去设置</Link>
      </div>
    </div>
  );
}
