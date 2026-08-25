"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  upsertAiKey,
  deleteAiKey,
  setDefaultAiProvider,
  type AiKeyOverview,
} from "@/lib/actions/ai-keys";
import {
  AI_PROVIDER_OPTIONS,
  GEMINI_KNOWN_MODELS,
  OPENAI_COMPATIBLE_PROVIDERS,
} from "@/lib/ai-provider-labels";
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
          有两类功能会挑服务商：<span className="font-medium">读文件</span>
          （简历体检、岗位匹配）只能用 Gemini/Claude/OpenAI；
          <span className="font-medium">联网搜索</span>
          （AI 搜索公司、岗位口碑）可以用 Qwen/Gemini/Claude/OpenAI。都会优先用你的默认服务商，
          不支持时自动换成你配了的、支持的那个。搜索优先挑 Qwen——Gemini 免费版的联网搜索额度
          极少，很快就会用完。
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
  const savedModels = (entry.model ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const [checkedKnown, setCheckedKnown] = useState<Set<string>>(
    () => new Set(savedModels.filter((m) => (GEMINI_KNOWN_MODELS as readonly string[]).includes(m)))
  );
  const [customModel, setCustomModel] = useState(
    savedModels.filter((m) => !(GEMINI_KNOWN_MODELS as readonly string[]).includes(m)).join(", ")
  );
  // Non-Gemini providers keep the plain single-model text field they always had.
  const [model, setModel] = useState(entry.provider === "gemini" ? "" : (entry.model ?? ""));
  const [baseUrl, setBaseUrl] = useState(entry.baseUrl ?? "");
  const [loading, setLoading] = useState(false);
  const [settingDefault, setSettingDefault] = useState(false);
  const isOpenAiCompatible = OPENAI_COMPATIBLE_PROVIDERS.includes(entry.provider);

  const meta = AI_PROVIDER_OPTIONS.find((p) => p.id === entry.provider)!;

  function toggleKnownModel(m: string) {
    setCheckedKnown((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }

  async function handleSave() {
    if (!apiKey) {
      toast.error("请填写 API Key");
      return;
    }
    const finalModel =
      entry.provider === "gemini"
        ? [
            ...GEMINI_KNOWN_MODELS.filter((m) => checkedKnown.has(m)),
            ...customModel.split(",").map((m) => m.trim()).filter(Boolean),
          ].join(", ")
        : model;
    setLoading(true);
    try {
      await upsertAiKey({
        provider: entry.provider,
        apiKey,
        model: finalModel || undefined,
        baseUrl: isOpenAiCompatible ? baseUrl || undefined : undefined,
      });
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

  const modelList = (entry.model ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const configuredLabel =
    modelList.length > 1
      ? `已配置 · ${modelList[0]} 等 ${modelList.length} 个模型`
      : `已配置${modelList[0] ? ` · ${modelList[0]}` : ""}`;

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{entry.label}</span>
          {entry.configured ? (
            <Badge variant="secondary" className="max-w-full" title={entry.model ?? undefined}>
              <span className="truncate">{configuredLabel}</span>
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
          {entry.provider === "gemini" ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                模型（可多选，按下面的顺序尝试；只勾一个就是固定用那个）
              </Label>
              <div className="space-y-1.5">
                {GEMINI_KNOWN_MODELS.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checkedKnown.has(m)}
                      onCheckedChange={() => toggleKnownModel(m)}
                    />
                    {m}
                  </label>
                ))}
              </div>
              <Input
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="其他模型名（可选，逗号分隔）"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground">
                Gemini 的免费额度是按模型分别计算的，勾选多个的话，一个用完额度会自动换下一个。
              </p>
            </div>
          ) : (
            <>
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
              {isOpenAiCompatible && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    API 地址（可选，不填用默认地址）
                  </Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://.../compatible-mode/v1"
                  />
                  <p className="text-xs text-muted-foreground">
                    工作空间专属网关（比如阿里云百炼）或者自建代理地址填这里，不填就用这个
                    服务商的公共默认地址。
                  </p>
                </div>
              )}
            </>
          )}
          <Button type="button" size="sm" disabled={loading} onClick={handleSave}>
            {loading ? "保存中..." : "保存"}
          </Button>
        </div>
      )}
    </div>
  );
}
