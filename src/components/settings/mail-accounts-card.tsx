"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addMailAccount,
  setMailAccountEnabled,
  deleteMailAccount,
  type MailAccountOverview,
} from "@/lib/actions/mail-accounts";
import { scanInboxNow } from "@/lib/actions/inbox-scan";
import { EMAIL_PROVIDER_OPTIONS } from "@/lib/email-provider-labels";
import type { EmailProviderId } from "@/lib/email-provider-labels";

/**
 * A recruiter's required inbox varies by company — Tencent asks for QQ
 * mail, NetEase for 163, and so on — so scanning one mailbox alone misses
 * whatever arrived at the others. This lets the user add as many as they
 * actually use, each scanned independently.
 */
export function MailAccountsCard({ accounts }: { accounts: MailAccountOverview[] }) {
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function handleScanAll() {
    setScanning(true);
    try {
      const res = await scanInboxNow();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { found, scanned, failedAccounts } = res.data;
      if (failedAccounts.length > 0) {
        toast.error(`${failedAccounts.join("、")} 连接失败，检查一下 IMAP 地址和授权码`);
      }
      toast.success(
        found > 0
          ? `扫了 ${scanned} 封新邮件，${found} 封求职相关已加入日程`
          : `扫了 ${scanned} 封新邮件，没有求职相关的`
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>收件箱扫描</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          可以加多个邮箱一起扫——投腾讯要留 QQ 邮箱、投网易要留 163 邮箱这种情况，
          加进来的每个邮箱都会各自检查最近的新邮件（最多 20 封），用 AI 判断是不是
          面试邀请/笔试通知/offer/拒信，是的话自动加进「我的日程」。只读，不会修改、
          标记或删除任何邮件。需要先在「AI 设置」里配置好 Key。
        </p>

        {accounts.length > 0 && (
          <div className="space-y-2">
            {accounts.map((a) => (
              <AccountRow key={a.id} account={a} />
            ))}
          </div>
        )}

        {adding ? (
          <AddAccountForm onDone={() => setAdding(false)} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 size-4" />
              添加邮箱
            </Button>
            {accounts.some((a) => a.enabled) && (
              <Button type="button" variant="outline" size="sm" disabled={scanning} onClick={handleScanAll}>
                <RefreshCw className="mr-1.5 size-4" />
                {scanning ? "扫描中..." : "立即扫描全部"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccountRow({ account }: { account: MailAccountOverview }) {
  const [enabled, setEnabled] = useState(account.enabled);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setEnabled(next);
    setBusy(true);
    try {
      const res = await setMailAccountEnabled(account.id, next);
      if (!res.ok) {
        toast.error(res.message);
        setEnabled(!next);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Mail className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{account.label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {account.email} · {account.imapHost}
            {account.lastCheckedAt &&
              ` · 上次扫描 ${new Date(account.lastCheckedAt).toLocaleString()}`}
          </p>
        </div>
        {!enabled && <Badge variant="outline">已暂停</Badge>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={enabled}
            onCheckedChange={(c) => toggle(c === true)}
            disabled={busy}
          />
          扫描
        </label>
        <ConfirmDeleteButton
          trigger={
            <Button type="button" variant="ghost" size="sm">
              删除
            </Button>
          }
          title={`删除邮箱「${account.label}」？`}
          onConfirm={async () => {
            const res = await deleteMailAccount(account.id);
            if (!res.ok) toast.error(res.message);
            else toast.success("已删除");
          }}
        />
      </div>
    </div>
  );
}

function AddAccountForm({ onDone }: { onDone: () => void }) {
  const [provider, setProvider] = useState<EmailProviderId>("qq");
  const [imapHost, setImapHost] = useState(
    EMAIL_PROVIDER_OPTIONS.find((p) => p.id === "qq")!.imapHost
  );
  const [imapPort, setImapPort] = useState(
    String(EMAIL_PROVIDER_OPTIONS.find((p) => p.id === "qq")!.imapPort)
  );
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const providerMeta = EMAIL_PROVIDER_OPTIONS.find((p) => p.id === provider)!;

  function handleProviderChange(next: EmailProviderId) {
    setProvider(next);
    const meta = EMAIL_PROVIDER_OPTIONS.find((p) => p.id === next)!;
    if (next !== "custom") {
      setImapHost(meta.imapHost);
      setImapPort(String(meta.imapPort));
    }
    if (!label || label === providerMeta.label) setLabel(meta.label);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await addMailAccount({
        label: label || undefined,
        imapHost,
        imapPort: Number(imapPort),
        email,
        password,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("已添加，之后每次扫描都会一起检查这个邮箱");
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">邮箱服务商</Label>
          <Select value={provider} onValueChange={(v) => v && handleProviderChange(v as EmailProviderId)}>
            <SelectTrigger className="w-full">
              <SelectValue>{() => providerMeta.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {EMAIL_PROVIDER_OPTIONS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{providerMeta.help}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">备注名（可选）</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="比如：QQ邮箱" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">邮箱地址</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">授权码 / 应用密码</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {provider === "custom" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">IMAP 服务器</Label>
              <Input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">IMAP 端口</Label>
              <Input type="number" value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
            </div>
          </>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={loading || !email || !password}>
          {loading ? "添加中..." : "添加"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          取消
        </Button>
      </div>
    </form>
  );
}
