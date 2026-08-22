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
import { updateAiSettings, clearAiSettings } from "@/lib/actions/account";
import { AI_PROVIDER_OPTIONS } from "@/lib/ai-provider-labels";
import type { AiProviderId } from "@/lib/ai-provider-labels";

export function AiSettingsForm({
  currentProvider,
  currentModel,
}: {
  currentProvider: AiProviderId | null;
  currentModel: string | null;
}) {
  const [provider, setProvider] = useState<AiProviderId>(currentProvider ?? "gemini");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  const providerMeta = AI_PROVIDER_OPTIONS.find((p) => p.id === provider)!;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey) {
      toast.error("请填写 API Key");
      return;
    }
    setLoading(true);
    try {
      await updateAiSettings({ provider, apiKey, model: model || undefined });
      toast.success("已保存，之后 AI 功能会优先用你自己的 Key");
      setApiKey("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await clearAiSettings();
      toast.success("已清除，AI 功能在重新配置 Key 之前都用不了");
    } catch {
      toast.error("清除失败，请重试");
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 设置</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {currentProvider ? (
            <>
              当前使用你自己的{" "}
              {AI_PROVIDER_OPTIONS.find((p) => p.id === currentProvider)?.label}
              （{currentModel || "默认模型"}）。简历体检、匹配、面试攻略等功能都会
              优先用这个 Key。
            </>
          ) : (
            "尚未配置——这是本地单机版，没有共享额度，AI 功能（简历体检、匹配、面试攻略、模拟面试等）都需要你自己的 API Key 才能用。"
          )}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">服务商</Label>
            <Select
              value={provider}
              onValueChange={(v) => v && setProvider(v as AiProviderId)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {() =>
                    AI_PROVIDER_OPTIONS.find((p) => p.id === provider)?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {AI_PROVIDER_OPTIONS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              API Key（{providerMeta.keyHelp}）
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={currentProvider === provider ? "已设置，留空则不修改" : ""}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              模型（可选，默认 {providerMeta.defaultModel}）
            </Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={providerMeta.defaultModel}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={loading}>
              {loading ? "保存中..." : "保存"}
            </Button>
            {currentProvider && (
              <Button
                type="button"
                variant="ghost"
                disabled={clearing}
                onClick={handleClear}
              >
                {clearing ? "清除中..." : "清除"}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
