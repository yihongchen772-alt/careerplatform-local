"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, ScanSearch, Trash2 } from "lucide-react";
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
import { deleteApplicationPortal, setCompanyPortalUrl, syncPortalsNow } from "@/lib/actions/application-sync";
import { STAGE_LABELS } from "@/lib/stage-labels";

export type PortalCompany = {
  id: string;
  name: string;
  /** How many applications at this company are still in flight. */
  activeCount: number;
  portals: { id: string; label: string | null; url: string; lastCheckedAt: string | null; lastSuccessfulAt: string | null; lastError: string | null }[];
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
  const [syncSummary, setSyncSummary] = useState<{
    matched: number;
    unmatched: number;
    unchanged: number;
  } | null>(null);

  const canSet = !!currentUrl && currentUrl !== "about:blank";
  const configured = companies.flatMap((c) => c.portals.map((p) => ({ ...p, companyName: c.name, activeCount: c.activeCount })));

  async function handleSet() {
    if (!companyId || !currentUrl || saving) return;
    setSaving(true);
    try {
      const res = await setCompanyPortalUrl(companyId, currentUrl, currentTitle);
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
    const res = await deleteApplicationPortal(id);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    router.refresh();
  }

  async function handleSync(id?: string, force = false) {
    if (syncing) return;
    setSyncing(id ?? "all");
    try {
      const res = await syncPortalsNow(id, force);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { changed, review, errors, checked, matched, unmatched, unchanged, unassigned } = res.data;
      setSyncSummary({ matched: matched.length, unmatched: unmatched.length, unchanged: unchanged.length });
      if (changed.length > 0) {
        toast.success(
          `${changed.length} 条投递阶段已更新：` +
            changed
              .map((c) => `${c.companyName} ${c.title} ${STAGE_LABELS[c.from]}→${STAGE_LABELS[c.to]}`)
              .join("；")
        );
      } else if (errors.length === 0 && checked === 0 && unassigned.length === 0) {
        toast.info("没有需要检查的投递（都已结束，或没设进度页）");
      }
      if (matched.length > 0) toast.success(`成功匹配 ${matched.length} 条官网投递`);
      if (review.length > 0) {
        const rejected = review.filter((item) => item.to === "REJECTED").length;
        toast.warning(rejected > 0 ? `官网提示 ${rejected} 条投递未通过，请在投递看板核对` : `${review.length} 条官网结果或非标准阶段顺序已放入投递看板，等待你核对`);
      }
      if (unmatched.length > 0) toast.info(`有 ${unmatched.length} 条本地投递未匹配到官网记录`);
      if (unassigned.length > 0) toast.warning(`${unassigned.length} 条投递尚未指定进度页，请到投递详情关联`);
      if (unchanged.length > 0) toast.info(`有 ${unchanged.length} 家公司状态未变化`);
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
            会用同一个登录态重开这页，读取每条投递的官网状态。常见阶段自动更新；未通过、Offer 或不同于常规顺序的阶段会先请你核对。
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
              <div className="flex items-center gap-1">
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
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="全部强制重识别"
                  title="全部强制重识别"
                  disabled={syncing !== null}
                  onClick={() => handleSync(undefined, true)}
                >
                  <ScanSearch className={syncing === "all" ? "size-4 animate-pulse" : "size-4"} />
                </Button>
              </div>
            )}
          </div>
          {syncSummary && (
            <p className="text-xs text-muted-foreground">
              最近结果：成功匹配 {syncSummary.matched} 条，未匹配 {syncSummary.unmatched} 条，未变化 {syncSummary.unchanged} 家
            </p>
          )}
          {configured.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有——设一个试试。</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {configured.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.companyName}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {c.activeCount} 条进行中
                      </span>
                    </p>
                    {c.label && <p className="truncate text-xs text-muted-foreground">{c.label}</p>}
                    <p className="truncate text-xs text-muted-foreground" title={c.url}>
                      {c.url}
                    </p>
                    {c.lastError && <p className="mt-0.5 text-xs text-destructive">上次失败：{c.lastError}</p>}
                    {c.lastSuccessfulAt ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        上次成功 {new Date(c.lastSuccessfulAt).toLocaleString("zh-CN")}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs text-muted-foreground">尚无成功同步记录</p>
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
                      aria-label="强制重识别"
                      title="强制重识别"
                      disabled={syncing !== null}
                      onClick={() => handleSync(c.id, true)}
                    >
                      <ScanSearch className={syncing === c.id ? "size-4 animate-pulse" : "size-4"} />
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
