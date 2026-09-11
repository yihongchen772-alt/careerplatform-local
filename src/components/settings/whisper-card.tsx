"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateAppSettings } from "@/lib/actions/app-settings";
import type { AppSettings } from "@/lib/app-settings-shared";
import type { WhisperModelName, WhisperStatus } from "@/types/desktop-bridge";

function mb(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * 面试录音's local transcription: shows whether the bundled whisper.cpp
 * binary is there and lets the user download/delete the models. Model
 * choice is stored in app-settings.json (the main process reads it when
 * transcribing); download progress streams back over the desktopWhisper
 * bridge (electron/preload.js).
 */
export function WhisperCard({ initial }: { initial: AppSettings }) {
  const [status, setStatus] = useState<WhisperStatus | null>(null);
  const [preferred, setPreferred] = useState<WhisperModelName>(initial.whisperModel ?? "small");
  const [busy, setBusy] = useState(false);
  const api = typeof window !== "undefined" ? window.desktopWhisper : undefined;

  useEffect(() => {
    if (!api) return;
    api.getStatus().then(setStatus).catch(() => {});
    return api.onStatus(setStatus);
  }, [api]);

  async function choose(name: WhisperModelName) {
    setPreferred(name);
    const res = await updateAppSettings({ whisperModel: name });
    if (!res.ok) toast.error(res.message);
  }

  async function download(name: WhisperModelName) {
    if (!api || busy) return;
    setBusy(true);
    try {
      await choose(name);
      await api.downloadModel(name);
      toast.success("模型下载完成，之后的面试录音会在本机转写");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下载失败");
    } finally {
      setBusy(false);
      api.getStatus().then(setStatus).catch(() => {});
    }
  }

  async function remove(name: WhisperModelName) {
    if (!api) return;
    await api.deleteModel(name);
    api.getStatus().then(setStatus).catch(() => {});
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>面试录音 · 本地转写</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          一场真实面试的录音是这个 App 里最私密的东西。下载一个转写模型后，录音在你自己电脑上用 whisper.cpp
          转成文字，音频不会上传到任何地方；没下载的话会退回用 Gemini 转写（录音会发给 Google）。模型只用下载一次。
        </p>
        {!api ? (
          <p className="text-sm text-muted-foreground">本地转写只在桌面版里可用。</p>
        ) : !status ? (
          <p className="text-sm text-muted-foreground">读取状态中…</p>
        ) : !status.binaryAvailable ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            这个安装包里没有带转写程序，本地转写不可用——会用 Gemini 转写。
          </p>
        ) : (
          <div className="space-y-2">
            {(Object.keys(status.models) as WhisperModelName[]).map((name) => {
              const m = status.models[name];
              const downloading = status.downloading?.name === name ? status.downloading : null;
              return (
                <div key={name} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="whisper-model"
                      checked={preferred === name}
                      onChange={() => choose(name)}
                      disabled={busy}
                    />
                    <span>
                      {m.label}
                      {m.installed && (
                        <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">已下载</span>
                      )}
                      {status.activeModel === name && (
                        <span className="ml-2 text-xs text-muted-foreground">（当前使用）</span>
                      )}
                    </span>
                  </label>
                  {downloading ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {mb(downloading.received)} / {mb(downloading.total)}
                      </span>
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.round((downloading.received / Math.max(1, downloading.total)) * 100)}%` }}
                        />
                      </div>
                      <Button type="button" size="icon" variant="ghost" aria-label="取消下载" onClick={() => api.cancelDownload()}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : m.installed ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => remove(name)} disabled={busy}>
                      <Trash2 className="size-4" />
                      删除
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => download(name)} disabled={busy || !!status.downloading}>
                      <Download className="size-4" />
                      下载
                    </Button>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              从 hf-mirror.com 下载，国内网络可直连。中文识别：小模型够用，中模型明显更准但转写慢一倍左右。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
