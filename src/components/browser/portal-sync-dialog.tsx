"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setCompanyPortalUrl, syncPortalsNow } from "@/lib/actions/application-sync";
import { STAGE_LABELS } from "@/lib/stage-labels";

export type PortalCompany = {
  id: string;
  name: string;
  /** How many applications at this company are still in flight. */
  activeCount: number;
  portalUrl: string | null;
  portalLastCheckedAt: string | null;
  portalLastError: string | null;
};

/**
 * Two jobs in one dialog: "make the page I'm looking at this company's
 * progress page" (when opened from the toolbar with a current URL), and a
 * list of every company that already has one, with a manual sync button —
 * so the user can see it working before trusting the background timer.
 */
export function PortalSyncDialog({
  open,
  onOpenChange,
  currentUrl,
  currentTitle,
  companies,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrl: string | null;
  currentTitle: string | null;
  companies: PortalCompany[];
}) {
  const router = useRouter();
  // Best guess: the company whose name shows up in the page title.
  const guessed = companies.find((c) => currentTitle && currentTitle.includes(c.name))?.id ?? "";
  const [companyId, setCompanyId] = useState(guessed);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | "all" | null>(null);

  const canSet = !!currentUrl && currentUrl !== "about:blank";
  const configured = companies.filter((c) => c.portalUrl);

  async function handleSet() {
    if (!companyId || !currentUrl || saving) return;
    setSaving(true);
    try {
      const res = await setCompanyPortalUrl(companyId, currentUrl);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("已设为进度页——第一次同步会读一遍这页，之后按设置里的频率自动检查");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleClear(id: string) {
    const res = await setCompanyPortalUrl(id, null);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    router.refresh();
  }

  async function handleSync(id?: string) {
    if (syncing) return;
    setSyncing(id ?? "all");
    try {
      const res = await syncPortalsNow(id);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { changed, errors, checked } = res.data;
      if (changed.length > 0) {
        toast.success(
          `${changed.length} 条投递阶段已更新：` +
            changed
              .map((c) => `${c.companyName} ${c.title} ${STAGE_LABELS[c.from]}→${STAGE_LABELS[c.to]}`)
              .join("；")
        );
      } else if (errors.length === 0) {
        toast.info(checked > 0 ? "读了一遍，官网状态和看板一致" : "没有需要检查的投递（都已结束，或没设进度页）");
      }
      for (const e of errors) toast.error(`${e.companyName}：${e.message}`);
      router.refresh();
    } finally {
      setSyncing(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>网申进度同步</DialogTitle>
          <DialogDescription>
            登录某家公司的招聘系统、打开「我的投递」页面后，把它设为这家公司的进度页。之后 App
            会用同一个登录态悄悄重开这页，让 AI 读出每条投递到哪一步了，看板自动往前推（只前进不后退）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium">把当前页设为进度页</p>
          {canSet ? (
            <>
              <p className="truncate text-xs text-muted-foreground" title={currentUrl ?? ""}>
                {currentUrl}
              </p>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">这是哪家公司的</Label>
                <Select value={companyId} onValueChange={(v) => v && setCompanyId(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选公司">
                      {(value: string) => companies.find((c) => c.id === value)?.name ?? "选公司"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.activeCount > 0 ? `（${c.activeCount} 条进行中）` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" size="sm" disabled={!companyId || saving} onClick={handleSet}>
                {saving ? "保存中..." : "设为进度页"}
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">先在浏览器里打开某家公司的「我的投递」页面。</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">已设进度页的公司（{configured.length}）</p>
            {configured.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={syncing !== null}
                onClick={() => handleSync()}
              >
                <RefreshCw className={syncing === "all" ? "size-4 animate-spin" : "size-4"} />
                全部同步
              </Button>
            )}
          </div>
          {configured.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有——设一个试试。</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {configured.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.name}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {c.activeCount} 条进行中
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground" title={c.portalUrl ?? ""}>
                      {c.portalUrl}
                    </p>
                    {c.portalLastError ? (
                      <p className="mt-0.5 text-xs text-destructive">{c.portalLastError}</p>
                    ) : c.portalLastCheckedAt ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        上次检查 {new Date(c.portalLastCheckedAt).toLocaleString("zh-CN")}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted-foreground">还没检查过</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="立即同步"
                      disabled={syncing !== null}
                      onClick={() => handleSync(c.id)}
                    >
                      <RefreshCw className={syncing === c.id ? "size-4 animate-spin" : "size-4"} />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="取消进度页"
                      onClick={() => handleClear(c.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <p className="text-xs text-muted-foreground">
            自动检查的频率在「账号设置 → 后台提醒」里开。
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
