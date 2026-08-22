"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  upsertAiKey,
  deleteAiKey,
  setDefaultAiProvider,
  type AiKeyOverview,
} from "@/lib/actions/ai-keys";
import { AI_PROVIDER_OPTIONS } from "@/lib/ai-provider-labels";
import type { AiProviderId } from "@/lib/ai-provider-labels";

export function AiSettingsForm({ keys }: { keys: AiKeyOverview[] }) {
  const [editing, setEditing] = useState<AiProviderId | null>(null);
  const hasAnyKey = keys.some((k) => k.configured);

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI 设置 · API 管理</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {hasAnyKey
            ? "可以同时配置多个服务商的 Key，切换默认服务商供面试攻略、模拟面试等文字类功能使用。"
            : "这是本地单机版，没有共享额度，AI 功能都需要你自己的 API Key 才能用。"}
          简历体检、岗位匹配、JD 解析需要直接读取 PDF/图片文件，这三个功能固定用下面的
          Gemini Key（其他服务商做不到读文件），和&ldquo;默认&rdquo;选择无关。
        </p>

        <div className="space-y-2">
          {keys.map((k) => (
            <ProviderRow
              key={k.provider}
              entry={k}
              editing={editing === k.provider}
              onEdit={() => setEditing(k.provider)}
              onCancelEdit={() => setEditing(null)}
              onSaved={() => setEditing(null)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderRow({
  entry,
  editing,
  onEdit,
  onCancelEdit,
  onSaved,
}: {
  entry: AiKeyOverview;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(entry.model ?? "");
  const [loading, setLoading] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);

  const meta = AI_PROVIDER_OPTIONS.find((p) => p.id === entry.provider)!;

  async function handleSave() {
    if (!apiKey) {
      toast.error("请填写 API Key");
      return;
    }
    setLoading(true);
    try {
      await upsertAiKey({ provider: entry.provider, apiKey, model: model || undefined });
      toast.success(`${entry.label} 已保存`);
      setApiKey("");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    await deleteAiKey(entry.provider);
    toast.success(`已删除 ${entry.label} 的 Key`);
  }

  async function handleSetDefault() {
    setSettingDefault(true);
    try {
      const result = await setDefaultAiProvider(entry.provider);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`已将 ${entry.label} 设为默认`);
    } finally {
      setSettingDefault(false);
    }
  }

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{entry.label}</span>
          {entry.configured ? (
            <Badge variant="secondary">
              已配置{entry.model ? ` · ${entry.model}` : ""}
            </Badge>
          ) : (
            <Badge variant="outline">未配置</Badge>
          )}
          {entry.isDefault && <Badge>默认</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {entry.configured && !entry.isDefault && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={settingDefault}
              onClick={handleSetDefault}
            >
              设为默认
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={editing ? onCancelEdit : onEdit}>
            {editing ? "取消" : entry.configured ? "编辑" : "配置"}
          </Button>
          {entry.configured && (
            <ConfirmDeleteButton
              trigger={
                <Button type="button" variant="ghost" size="sm">
                  删除
                </Button>
              }
              title={`删除 ${entry.label} 的 Key？`}
              onConfirm={handleDelete}
            />
          )}
        </div>
      </div>

      {editing && (
        <div className="space-y-2 pt-1">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              API Key（{meta.keyHelp}）
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={entry.configured ? "已设置，重新填写以更新" : ""}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              模型（可选，默认 {meta.defaultModel}）
            </Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={meta.defaultModel}
            />
          </div>
          <Button type="button" size="sm" disabled={loading} onClick={handleSave}>
            {loading ? "保存中..." : "保存"}
          </Button>
        </div>
      )}
    </div>
  );
}
