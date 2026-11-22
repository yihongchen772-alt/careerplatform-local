"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Laptop,
  Loader2,
  Lock,
  Radio,
  ShieldCheck,
  StopCircle,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type PendingLanImport = {
  stagingId: string;
  sender: { hostname: string; platform: string; sizeMb: string };
  preview: { exportedAt: string; counts: { label: string; n: number }[]; files: number };
};

function formatCode(code: string): string {
  const digits = code.replace(/\D/g, "");
  return digits.length === 6 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : code;
}

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LanSyncCard() {
  const [tab, setTab] = useState<"send" | "receive">("send");
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<DesktopLanSyncStatus>({ active: false });
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>("");
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Receive side
  const [peerAddress, setPeerAddress] = useState("");
  const [peerCode, setPeerCode] = useState("");
  const [pulling, setPulling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<PendingLanImport | null>(null);

  useEffect(() => {
    let active = true;
    const bridge = typeof window !== "undefined" ? window.desktopLanSync : undefined;
    Promise.resolve().then(async () => {
      if (!active) return;
      if (!bridge) {
        setSupported(false);
        return;
      }
      setSupported(true);
      const res = await bridge.status().catch(() => null);
      if (!active || !res || !res.ok) return;
      setStatus(res.data);
      if (res.data.active) {
        setSelectedEndpoint(res.data.primaryAddress);
        setSecondsLeft(Math.max(0, Math.ceil((new Date(res.data.expiresAt).getTime() - Date.now()) / 1000)));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!status.active) return;
    const expiresMs = new Date(status.expiresAt).getTime();
    const timer = window.setInterval(async () => {
      const left = Math.max(0, Math.ceil((expiresMs - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        const res = await window.desktopLanSync?.status().catch(() => null);
        if (res && res.ok) setStatus(res.data);
        else setStatus({ active: false });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  async function handleStartShare() {
    if (!window.desktopLanSync) return;
    setBusy(true);
    try {
      const res = await window.desktopLanSync.startShare();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setStatus(res.data);
      if (res.data.active) {
        setSelectedEndpoint(res.data.primaryAddress);
        setSecondsLeft(Math.max(0, Math.ceil((new Date(res.data.expiresAt).getTime() - Date.now()) / 1000)));
        toast.success("已开启 5 分钟局域网加密发送（AES-256-GCM）");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleStopShare() {
    if (!window.desktopLanSync) return;
    setBusy(true);
    try {
      const res = await window.desktopLanSync.stopShare();
      if (res.ok) {
        setStatus(res.data);
        setSecondsLeft(0);
        toast.info("已关闭局域网发送并清空内存加密副本");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyText(key: string, value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      toast.success(`已复制${label}`);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1800);
    } catch {
      toast.error("复制失败，请手动选中复制");
    }
  }

  function handleAddressInputChange(value: string) {
    const trimmed = value.trim();
    if (trimmed.includes("#")) {
      const [left, right] = trimmed.split("#", 2);
      setPeerAddress(left.trim());
      const digits = (right ?? "").replace(/\D/g, "").slice(0, 6);
      if (digits) setPeerCode(digits);
      return;
    }
    setPeerAddress(value);
  }

  async function handlePullPreview() {
    if (!window.desktopLanSync) return;
    if (!peerAddress.trim()) {
      toast.error("请先输入发送方局域网地址或粘贴一键配对口令");
      return;
    }
    setPulling(true);
    try {
      const res = await window.desktopLanSync.pull({
        address: peerAddress.trim(),
        code: peerCode.trim(),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setPending({
        stagingId: res.stagingId,
        sender: res.sender,
        preview: res.preview,
      });
    } finally {
      setPulling(false);
    }
  }

  async function handleConfirmImport() {
    if (!pending || !window.desktopLanSync) return;
    setImporting(true);
    try {
      const res = await window.desktopLanSync.confirmImport(pending.stagingId);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const parts = [`已同步恢复 ${res.data.restored} 条数据`];
      if (res.data.skipped > 0) parts.push(`跳过 ${res.data.skipped} 条关联缺失数据`);
      if (res.data.filesMigrated > 0) parts.push(`搬运 ${res.data.filesMigrated} 个附件`);
      toast.success(`${parts.join("，")}，刷新页面即可看到最新数据`);
      setPending(null);
      setPeerCode("");
    } finally {
      setImporting(false);
    }
  }

  async function handleCancelImport() {
    if (pending && window.desktopLanSync) {
      await window.desktopLanSync.discardStaged(pending.stagingId).catch(() => {});
    }
    setPending(null);
  }

  const activeEndpoint =
    status.active ? (selectedEndpoint || status.primaryAddress) : "";
  const activePairingToken =
    status.active ? `${activeEndpoint}#${status.code}` : "";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wifi className="size-4 text-primary" />
            跨设备局域网加密一键互传（Mac ↔ Windows）
          </CardTitle>
          <Badge variant="outline" className="gap-1 text-[11px] font-normal">
            <ShieldCheck className="size-3 text-emerald-600" />
            AES-256-GCM · 仅局域网直连
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          在同一个 Wi-Fi / 热点下，无需 U 盘、无需上传云端，用一次性 6 位配对码直接把整库数据（含简历、附件、AI 配置与小欧记忆）加密传到另一台电脑。
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {supported === false ? (
          <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            局域网点对点加密互传仅在桌面端客户端（macOS / Windows）可用；网页模式请使用下方「备份与恢复」手动导出 JSON。
          </div>
        ) : (
          <>
            <div className="inline-flex rounded-xl border bg-muted/30 p-1 text-xs">
              <button
                type="button"
                onClick={() => setTab("send")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors",
                  tab === "send"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Radio className="size-3.5" />
                从这台电脑发送
                {status.active && <span className="size-1.5 rounded-full bg-emerald-500" />}
              </button>
              <button
                type="button"
                onClick={() => setTab("receive")}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors",
                  tab === "receive"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Download className="size-3.5" />
                接收另一台电脑的数据
              </button>
            </div>

            {tab === "send" ? (
              !status.active ? (
                <div className="flex flex-col items-start justify-between gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center">
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">默认完全关闭对外端口，仅在点击开启后临时监听 5 分钟</p>
                    <p>所有数据会先经 Gzip 压缩，再用随机 6 位配对码派生密钥进行 AES-256-GCM 端到端加密；连续输错 5 次配对码会自动熔断关闭。</p>
                  </div>
                  <Button type="button" onClick={handleStartShare} disabled={busy || supported === null} className="shrink-0">
                    {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Lock className="mr-1.5 size-4" />}
                    {busy ? "正在打包加密..." : "开启本机加密发送"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="inline-flex size-2 animate-pulse rounded-full bg-emerald-500" />
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">
                        加密通道已开启 · 剩余 {formatRemaining(secondsLeft)} 自动关闭
                      </span>
                      <Badge variant="secondary" className="text-[11px]">
                        {status.sizeMb} MB · {status.files} 个附件
                      </Badge>
                      {status.transferCount > 0 && (
                        <Badge variant="outline" className="text-[11px]">
                          已被成功拉取 {status.transferCount} 次
                        </Badge>
                      )}
                    </div>
                    <Button type="button" size="sm" variant="destructive" onClick={handleStopShare} disabled={busy}>
                      <StopCircle className="mr-1 size-3.5" />
                      立即停止发送
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-background/90 p-3">
                      <div className="text-[11px] text-muted-foreground">一次性 6 位配对码</div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="font-mono text-2xl font-bold tracking-[0.2em] text-primary">
                          {formatCode(status.code)}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => copyText("code", status.code, "配对码")}
                        >
                          {copiedKey === "code" ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border bg-background/90 p-3">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>本机局域网地址</span>
                        <span>{status.platform} · {status.hostname}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-sm font-semibold">{activeEndpoint}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => copyText("addr", activeEndpoint, "局域网地址")}
                        >
                          {copiedKey === "addr" ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                        </Button>
                      </div>
                      {status.addresses.length > 1 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {status.addresses.map((item) => (
                            <button
                              key={item.endpoint}
                              type="button"
                              onClick={() => setSelectedEndpoint(item.endpoint)}
                              className={cn(
                                "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                                activeEndpoint === item.endpoint
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {item.name}: {item.address}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/70 px-3 py-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <span className="text-muted-foreground">一键配对口令（微信/QQ发给自己，在另一台电脑直接粘贴）：</span>
                      <code className="ml-1 font-mono font-medium text-foreground">{activePairingToken}</code>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => copyText("token", activePairingToken, "一键配对口令")}
                    >
                      {copiedKey === "token" ? <Check className="mr-1 size-3.5 text-emerald-600" /> : <Copy className="mr-1 size-3.5" />}
                      复制口令
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      对方局域网地址（或直接粘贴一键配对口令 `IP:端口#配对码`）
                    </label>
                    <Input
                      value={peerAddress}
                      onChange={(e) => handleAddressInputChange(e.target.value)}
                      placeholder="例如 192.168.1.42:54321 或 192.168.1.42:54321#482916"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">6 位配对码</label>
                    <Input
                      value={peerCode}
                      onChange={(e) => setPeerCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="6 位数字"
                      inputMode="numeric"
                      className="font-mono text-sm tracking-widest"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Laptop className="size-3.5" />
                    拉取后会先解密并展示数据清单预览，确认后才会覆盖本机数据。
                  </span>
                  <Button type="button" onClick={handlePullPreview} disabled={pulling || supported === null}>
                    {pulling ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Download className="mr-1.5 size-4" />}
                    {pulling ? "连接并解密中..." : "拉取并预览数据"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && void handleCancelImport()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认同步覆盖本机数据？</AlertDialogTitle>
            <AlertDialogDescription>
              已通过 AES-256-GCM 解密并校验来自另一台电脑的数据包。确认后将用该副本替换本机当前数据，无法撤销。
            </AlertDialogDescription>
            {pending && (
              <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>
                  来源设备：<span className="font-medium text-foreground">{pending.sender.platform} · {pending.sender.hostname}</span>（传输包 {pending.sender.sizeMb} MB）
                </p>
                <p>
                  打包时间：<span className="font-medium text-foreground">{pending.preview.exportedAt.slice(0, 19).replace("T", " ")}</span>
                </p>
                <p>
                  包含数据：
                  {pending.preview.counts.map((c) => `${c.label} ${c.n} 条`).join("、") || "（无业务数据）"}
                  {pending.preview.files > 0 && `，共 ${pending.preview.files} 个本地附件`}
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing} onClick={() => void handleCancelImport()}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={importing} onClick={handleConfirmImport}>
              {importing ? "正在恢复..." : "确认覆盖同步到本机"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
