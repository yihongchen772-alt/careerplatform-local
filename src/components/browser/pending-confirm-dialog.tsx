"use client";

import { ArrowUpRight, CheckCircle2, Clock3, KeyRound, Loader2, Pause, Play, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DesktopBridge, DesktopBridgeAutofillOptions, DesktopBridgeTab } from "@/types/desktop-bridge";

function hostLabel(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function statusBadge(tab: DesktopBridgeTab) {
  const st = tab.fillState?.status ?? "idle";
  if (st === "ready") {
    return (
      <Badge className="gap-1 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
        <CheckCircle2 className="size-3" />
        已预填 · 待核对提交
      </Badge>
    );
  }
  if (st === "filling") {
    return (
      <Badge variant="secondary" className="gap-1 text-primary">
        <Loader2 className="size-3 animate-spin" />
        正在填写
      </Badge>
    );
  }
  if (st === "loading" || st === "queued") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Clock3 className="size-3" />
        {st === "loading" ? "等待页面加载" : "队列等待中"}
      </Badge>
    );
  }
  if (st === "needs_login") {
    return (
      <Badge className="gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300">
        <KeyRound className="size-3" />
        需先登录
      </Badge>
    );
  }
  if (st === "recorded") {
    return <Badge variant="secondary">已记为投递</Badge>;
  }
  if (st === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <TriangleAlert className="size-3" />
        待人工处理
      </Badge>
    );
  }
  return <Badge variant="outline">未预填</Badge>;
}

export function isConfirmCandidate(tab: DesktopBridgeTab) {
  return !!tab.url && tab.url !== "about:blank" && tab.fillState?.status !== "recorded";
}

export function PendingConfirmDialog({
  open,
  onOpenChange,
  tabs,
  activeId,
  batchRunning,
  bridge,
  resumeVersionId,
  fillOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: DesktopBridgeTab[];
  activeId: number | null;
  batchRunning: boolean;
  bridge: DesktopBridge;
  resumeVersionId?: string;
  fillOptions: DesktopBridgeAutofillOptions;
}) {
  const openTabs = tabs.filter((t) => !!t.url && t.url !== "about:blank");
  const readyCount = openTabs.filter((t) => t.fillState?.status === "ready").length;
  const waitingCount = openTabs.filter((t) => !t.fillState || ["idle", "queued", "loading", "filling", "needs_login", "error"].includes(t.fillState.status)).length;
  const recordedCount = openTabs.filter((t) => t.fillState?.status === "recorded").length;

  async function goToTab(tabId: number) {
    await bridge.switchTab(tabId);
    onOpenChange(false);
  }

  async function refillTab(tabId: number) {
    await bridge.switchTab(tabId);
    onOpenChange(false);
    await bridge.autofill(resumeVersionId || undefined, fillOptions);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            待确认清单 · 多岗位批量网申
          </DialogTitle>
          <DialogDescription>
            自动填写和附件上传都在后台逐页完成，绝不替你点最终「提交」。挑有空的岗位逐个切过去核对一遍、点提交即可。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span>共 <strong>{openTabs.length}</strong> 个标签页</span>
            <span className="text-emerald-700 dark:text-emerald-400">待核对提交 {readyCount}</span>
            <span className="text-muted-foreground">待填 / 队列 {waitingCount}</span>
            {recordedCount > 0 && <span className="text-muted-foreground">已记投递 {recordedCount}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {batchRunning ? (
              <Button size="xs" variant="outline" onClick={() => void bridge.stopBatch?.()}>
                <Pause className="size-3.5" />
                暂停批量预填
              </Button>
            ) : (
              <Button
                size="xs"
                disabled={waitingCount === 0}
                onClick={() => void bridge.fillAllPending?.(resumeVersionId || undefined, fillOptions)}
              >
                <Play className="size-3.5" />
                一键预填所有待填页
              </Button>
            )}
            {recordedCount > 0 && (
              <Button size="xs" variant="ghost" onClick={() => void bridge.clearRecordedTabs?.()}>
                <Trash2 className="size-3.5" />
                清掉已记录
              </Button>
            )}
          </div>
        </div>

        <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
          {openTabs.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
              还没有打开的网申页面。可以在「秋招信息库」或「候选岗位池」勾选多个岗位「批量打开网申并预填」。
            </div>
          ) : (
            openTabs.map((tab) => {
              const metaTitle = tab.batchMeta?.company
                ? `${tab.batchMeta.company}${tab.batchMeta.title ? ` · ${tab.batchMeta.title}` : ""}`
                : tab.title || hostLabel(tab.url);
              const fs = tab.fillState;
              const isCurrent = tab.id === activeId;
              return (
                <div
                  key={tab.id}
                  className={`flex flex-col gap-2 rounded-xl border p-3 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                    isCurrent ? "border-primary/45 bg-primary/[0.04]" : "bg-card"
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{metaTitle}</span>
                      {statusBadge(tab)}
                      {isCurrent && <Badge variant="outline" className="text-[11px]">当前标签</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {hostLabel(tab.url)}
                      {fs && fs.filled + fs.manual + fs.uploaded > 0
                        ? ` · 已填 ${fs.filled} 项，待手填 ${fs.manual} 项${fs.uploaded > 0 ? `，已附带 ${fs.uploaded} 份附件${fs.uploadedNames?.length ? `（${fs.uploadedNames.join("、")}）` : ""}` : ""}`
                        : fs?.message
                        ? ` · ${fs.message}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="xs" variant={fs?.status === "ready" ? "default" : "outline"} onClick={() => void goToTab(tab.id)}>
                      <ArrowUpRight className="size-3.5" />
                      {fs?.status === "ready" ? "去核对提交" : fs?.status === "needs_login" ? "去登录" : "切换过去"}
                    </Button>
                    {fs?.status !== "filling" && fs?.status !== "recorded" && (
                      <Button size="xs" variant="ghost" onClick={() => void refillTab(tab.id)}>
                        重填
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label="关闭标签页"
                      onClick={() => void bridge.closeTab(tab.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
