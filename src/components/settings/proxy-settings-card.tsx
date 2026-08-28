"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateAppSettings, testProxyConnection } from "@/lib/actions/app-settings";
import type { AppSettings } from "@/lib/app-settings-shared";

export function ProxySettingsCard({ initial }: { initial: AppSettings }) {
  const [proxyUrl, setProxyUrl] = useState(initial.proxyUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await updateAppSettings({ proxyUrl: proxyUrl.trim() || undefined });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("已保存，立即生效，不用重启");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await testProxyConnection(proxyUrl);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`能连上 Google，${res.data.ms}ms`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>网络代理</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Gemini / OpenAI / Anthropic 这几家在国内需要代理才能访问。App 后台调用 AI
          时不会自动走你电脑上开的代理/VPN——不填这个的话，配好了 Key 也会一直卡住没反应。
          填你代理软件的 <span className="font-medium">HTTP 端口</span>
          （常见的比如 Clash 是 7890），不是 SOCKS5 端口。用国内厂商（DeepSeek/Kimi/Qwen）
          不需要代理，可以留空。
        </p>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">代理地址</Label>
          <Input
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            placeholder="http://127.0.0.1:7890"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
            {saving ? "保存中..." : "保存"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={testing}
            onClick={handleTest}
          >
            <Wifi />
            {testing ? "测试中..." : "测试能不能连上 Google"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
