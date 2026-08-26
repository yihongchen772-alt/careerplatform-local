"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updateEmailSettings,
  clearEmailSettings,
  sendTestEmail,
} from "@/lib/actions/email-settings";
import { EMAIL_PROVIDER_OPTIONS } from "@/lib/email-provider-labels";
import type { EmailProviderId } from "@/lib/email-provider-labels";

export function EmailSettingsForm({ currentUser }: { currentUser: string | null }) {
  const [provider, setProvider] = useState<EmailProviderId>("gmail");
  const [smtpHost, setSmtpHost] = useState(EMAIL_PROVIDER_OPTIONS[0].smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(EMAIL_PROVIDER_OPTIONS[0].smtpPort));
  const [email, setEmail] = useState(currentUser ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const providerMeta = EMAIL_PROVIDER_OPTIONS.find((p) => p.id === provider)!;

  function handleProviderChange(next: EmailProviderId) {
    setProvider(next);
    const meta = EMAIL_PROVIDER_OPTIONS.find((p) => p.id === next)!;
    if (next !== "custom") {
      setSmtpHost(meta.smtpHost);
      setSmtpPort(String(meta.smtpPort));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || !smtpHost) {
      toast.error("邮箱、授权码、SMTP 地址都要填");
      return;
    }
    setLoading(true);
    try {
      await updateEmailSettings({
        host: smtpHost,
        port: Number(smtpPort),
        user: email,
        password,
        from: email,
      });
      toast.success("已保存");
      setPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await sendTestEmail();
      if (res.ok) toast.success("测试邮件已发送，去收件箱看看");
      else toast.error(res.message);
    } finally {
      setTesting(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await clearEmailSettings();
      toast.success("已清除");
    } catch {
      toast.error("清除失败，请重试");
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>邮件提醒</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {currentUser ? (
            <>
              已配置 {currentUser}。每次打开 App 会自动检查一次，有紧急事项才发邮件；
              也可以在总览页手动点&ldquo;发送提醒邮件&rdquo;立即发一次。
            </>
          ) : (
            "填你自己的邮箱账号（用来自己发给自己），App 不用一直开着服务器，所以只在打开时检查一次。"
          )}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">邮箱服务商</Label>
            <Select
              value={provider}
              onValueChange={(v) => v && handleProviderChange(v as EmailProviderId)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {() => EMAIL_PROVIDER_OPTIONS.find((p) => p.id === provider)?.label}
                </SelectValue>
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={currentUser ? "已设置，留空则不修改" : ""}
              />
            </div>
          </div>

          {provider === "custom" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">SMTP 服务器（发信）</Label>
                <Input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.example.com"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">SMTP 端口</Label>
                <Input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={loading}>
              {loading ? "保存中..." : "保存"}
            </Button>
            {currentUser && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={testing}
                  onClick={handleTest}
                >
                  {testing ? "发送中..." : "发送测试邮件"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={clearing}
                  onClick={handleClear}
                >
                  {clearing ? "清除中..." : "清除"}
                </Button>
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
