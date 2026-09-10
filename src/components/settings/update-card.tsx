"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DesktopUpdateState, DesktopUpdates } from "@/types/desktop-updates";

const RELEASES_URL = "https://github.com/yihongchen772-alt/careerplatform-local/releases/latest";

export function UpdateCard({ currentVersion }: { currentVersion: string }) {
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const receiveState = useCallback((next: DesktopUpdateState) => {
    setState((current) => !current || next.revision >= current.revision ? next : current);
  }, []);

  useEffect(() => {
    const bridge = window.desktopUpdates;
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onState((next) => { if (active) receiveState(next); });
    bridge.getState().then((next) => { if (active) receiveState(next); }).catch(() => {
      if (active) setConnectionError("暂时无法连接桌面更新服务，请重启应用，或从发布页面下载安装包。");
    });
    return () => { active = false; unsubscribe(); };
  }, [receiveState]);

  async function run(action: "check" | "download" | "install" | "openReleases") {
    const bridge: DesktopUpdates | undefined = window.desktopUpdates;
    if (!bridge || requestPending) return;
    setRequestPending(true);
    setConnectionError("");
    try {
      receiveState(await bridge[action]());
    } catch {
      setConnectionError("操作未完成，请重试或重新打开应用。也可以从 GitHub 发布页面下载安装包。");
    } finally {
      setRequestPending(false);
    }
  }

  const busy = requestPending || state?.status === "checking" || state?.status === "downloading" || state?.status === "installing";
  const canDownload = state?.status === "available" || state?.status === "error" && state.errorStage === "download";
  const canInstall = state?.status === "downloaded" || state?.status === "error" && state.errorStage === "install";

  return (
    <Card>
      <CardHeader>
        <CardTitle>软件更新</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">当前版本 {state?.currentVersion ?? currentVersion}</span>
          {state?.availableVersion && <span className="text-muted-foreground">→ {state.availableVersion}</span>}
        </div>
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {state?.message ?? "桌面安装包提供 Windows x64 和 Apple 芯片 Mac DMG。Windows 桌面版可在应用内检查和安装更新，Mac 可以检查是否有新版本，但需要手动下载 DMG 替换应用。"}
        </p>
        {state?.status === "downloading" && (
          <div className="space-y-1">
            <progress className="h-2 w-full accent-primary" max={100} value={state.progress?.percent} aria-label="更新下载进度" />
            <p className="text-xs text-muted-foreground">
              {state.progress ? `已下载 ${state.progress.percent.toFixed(0)}%${state.progress.total > 0 ? `（${(state.progress.transferred / 1048576).toFixed(1)} / ${(state.progress.total / 1048576).toFixed(1)} MB）` : ""}` : "正在连接下载服务器…"}
            </p>
          </div>
        )}
        {connectionError && <p className="text-sm text-destructive" role="alert">{connectionError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {state?.mode === "in-app" && (
            canInstall ? (
              <Button type="button" disabled={busy} onClick={() => run("install")}>
                <RefreshCw className="size-4" />{state.errorStage === "install" ? "重试安装" : "重启并安装"}
              </Button>
            ) : canDownload ? (
              <Button type="button" disabled={busy} onClick={() => run("download")}>
                <Download className="size-4" />{state.errorStage === "download" ? "重试下载" : "下载更新"}
              </Button>
            ) : (
              <Button type="button" disabled={busy} onClick={() => run("check")}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {state.status === "checking" ? "检查中…" : state.status === "downloading" ? "下载中…" : state.status === "installing" ? "准备安装…" : "检查更新"}
              </Button>
            )
          )}
          {state?.mode === "check-only" && (
            <Button type="button" disabled={busy} onClick={() => run("check")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {state.status === "checking" ? "检查中…" : "检查更新"}
            </Button>
          )}
          {state ? (
            <Button type="button" variant="outline" disabled={state.status === "installing" || requestPending} onClick={() => run("openReleases")}>
              <ExternalLink className="size-4" />{state.platform === "darwin" ? "下载 Mac DMG" : "查看发布与安装包"}
            </Button>
          ) : (
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4">
              <ExternalLink className="size-4" />查看发布与安装包
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          更新包来自原项目的 GitHub Releases。更新保留本机数据；Windows 点击安装前会自动备份。
          Mac 替换应用前可先在「备份与恢复」导出备份。
        </p>
      </CardContent>
    </Card>
  );
}
