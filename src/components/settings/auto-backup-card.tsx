"use client";

import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { CloudUpload, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  runAutoBackupNow,
  saveAutoBackupSettings,
  testWebdavConnection,
  type AutoBackupSettings,
} from "@/lib/actions/auto-backup";

const INTERVALS = [
  { hours: 6, label: "每 6 小时" },
  { hours: 12, label: "每 12 小时" },
  { hours: 24, label: "每天" },
  { hours: 72, label: "每 3 天" },
  { hours: 168, label: "每周" },
];

const noop = () => () => {};

function formatTime(iso: string | null) {
  if (!iso) return "还没有";
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 自动备份: the same self-contained JSON as 导出备份, written on a schedule
 * into a folder a cloud drive already syncs and/or uploaded over WebDAV
 * (坚果云 etc.), keeping the newest N. Restore with 数据备份 → 导入.
 */
export function AutoBackupCard({ initial }: { initial: AutoBackupSettings }) {
  const [settings, setSettings] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [intervalHours, setIntervalHours] = useState(initial.intervalHours);
  const [keep, setKeep] = useState(String(initial.keep));
  const [folder, setFolder] = useState(initial.folder ?? "");
  const [webdavUrl, setWebdavUrl] = useState(initial.webdavUrl ?? "");
  const [webdavUser, setWebdavUser] = useState(initial.webdavUser ?? "");
  const [webdavPassword, setWebdavPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "run" | "test" | null>(null);
  const canPick = useSyncExternalStore(noop, () => !!window.desktopBridge?.chooseDirectory, () => false);

  async function save(next?: { enabled?: boolean; clearWebdav?: boolean }) {
    setBusy("save");
    try {
      const res = await saveAutoBackupSettings({
        enabled: next?.enabled ?? enabled,
        intervalHours,
        keep: Number(keep) || 7,
        folder: folder.trim() || null,
        webdavUrl: webdavUrl.trim() || null,
        webdavUser: webdavUser.trim() || null,
        webdavPassword: webdavPassword || null,
        clearWebdav: next?.clearWebdav,
      });
      if (!res.ok) {
        toast.error(res.message);
        return false;
      }
      setSettings(res.data);
      setEnabled(res.data.enabled);
      setWebdavPassword("");
      if (next?.clearWebdav) {
        setWebdavUrl("");
        setWebdavUser("");
      }
      toast.success(res.data.enabled ? "自动备份已开启" : "设置已保存");
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    if (!(await save())) return;
    setBusy("run");
    try {
      const res = await runAutoBackupNow();
      if (!res.ok) {
        toast.error(res.message);
        setSettings((s) => ({ ...s, lastError: res.message }));
        return;
      }
      toast.success(`已备份（${res.data.sizeMb}MB）：${[res.data.folder && "文件夹", res.data.webdav && "WebDAV"].filter(Boolean).join(" + ")}`);
      setSettings((s) => ({ ...s, lastAt: new Date().toISOString(), lastError: null }));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const res = await testWebdavConnection({ url: webdavUrl, user: webdavUser, password: webdavPassword || undefined });
      if (res.ok) toast.success("WebDAV 连接正常");
      else toast.error(res.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>自动备份</CardTitle>
        <p className="text-sm text-muted-foreground">
          定时把全部数据（含简历附件）备份到网盘同步文件夹或 WebDAV，只保留最近几份。换电脑或误删时，用「数据备份 → 导入」恢复。AI Key 和邮箱密码在备份里仍是加密的，换电脑后需要重新填写。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          开启自动备份（App 运行时按频率执行）
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">频率</Label>
            <Select value={String(intervalHours)} onValueChange={(v) => v && setIntervalHours(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue>{(value: string) => INTERVALS.find((i) => String(i.hours) === value)?.label ?? "每天"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((i) => (
                  <SelectItem key={i.hours} value={String(i.hours)}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">保留最近几份</Label>
            <Input type="number" min={1} max={60} value={keep} onChange={(e) => setKeep(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">备份文件夹（放在网盘同步目录里就会自动上传）</Label>
          <div className="flex gap-2">
            <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Users/你/Library/Mobile Documents/com~apple~CloudDocs/求职罗盘备份" />
            {canPick && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                onClick={async () => {
                  const picked = await window.desktopBridge?.chooseDirectory();
                  if (picked) setFolder(picked);
                }}
              >
                <FolderOpen className="size-4" />
                选择
              </Button>
            )}
          </div>
          {settings.suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>检测到：</span>
              {settings.suggestions.map((s) => (
                <Button key={s.path} type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" title={s.path} onClick={() => setFolder(s.path)}>
                  {s.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        <details className="rounded-md border p-3" open={!!settings.webdavUrl}>
          <summary className="cursor-pointer text-sm">WebDAV（可选，如坚果云）</summary>
          <div className="mt-3 space-y-2">
            <Input value={webdavUrl} onChange={(e) => setWebdavUrl(e.target.value)} placeholder="https://dav.jianguoyun.com/dav/求职罗盘备份/" />
            <div className="grid grid-cols-2 gap-2">
              <Input value={webdavUser} onChange={(e) => setWebdavUser(e.target.value)} placeholder="账号（邮箱）" autoComplete="off" />
              <Input
                type="password"
                value={webdavPassword}
                onChange={(e) => setWebdavPassword(e.target.value)}
                placeholder={settings.hasWebdavPassword ? "已保存（不改就留空）" : "应用密码"}
                autoComplete="new-password"
              />
            </div>
            <p className="text-xs text-muted-foreground">坚果云：账户信息 → 安全选项 → 添加应用，生成的应用密码填在这里（不是登录密码）。</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!webdavUrl || !webdavUser || busy !== null} onClick={test}>
                {busy === "test" ? "测试中…" : "测试连接"}
              </Button>
              {settings.webdavUrl && (
                <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => save({ clearWebdav: true })}>
                  移除 WebDAV
                </Button>
              )}
            </div>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={busy !== null} onClick={() => save()}>
            {busy === "save" ? "保存中…" : "保存设置"}
          </Button>
          <Button type="button" variant="outline" disabled={busy !== null || (!folder && !webdavUrl)} onClick={runNow}>
            <CloudUpload className="size-4" />
            {busy === "run" ? "备份中…" : "立即备份一次"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">上次自动备份：{formatTime(settings.lastAt)}</p>
        {settings.lastError && <p className="text-xs text-destructive">上次失败：{settings.lastError}</p>}
      </CardContent>
    </Card>
  );
}
