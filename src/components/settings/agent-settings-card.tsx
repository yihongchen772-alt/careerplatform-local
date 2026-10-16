"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateAgentSettings } from "@/lib/actions/agent-brief";
import { AI_PROVIDER_OPTIONS, SEED_MODELS, type AiProviderId } from "@/lib/ai-provider-labels";
import type { AiKeyOverview } from "@/lib/actions/ai-keys";

const FOLLOW = "__follow__";
const splitModels = (value: string | null) => (value ?? "").split(",").map((m) => m.trim()).filter(Boolean);

/**
 * 小欧's own model (a stronger one just for the agent; other features keep the
 * default) and its two scheduled briefs. Every change saves at once.
 */
export function AgentSettingsCard({ keys, initial }: { keys: AiKeyOverview[]; initial: { provider: string | null; model: string | null; dailyBrief: boolean; weeklyReview: boolean } }) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const configured = keys.filter((k) => k.configured);
  const value = settings.provider ? `${settings.provider}::${settings.model ?? ""}` : FOLLOW;
  const current = keys.find((k) => k.isDefault);

  async function save(next: typeof settings) {
    const previous = settings;
    setSettings(next);
    setSaving(true);
    try {
      const res = await updateAgentSettings(next);
      if (!res.ok) { setSettings(previous); toast.error(res.message); return; }
      toast.success("小欧的设置已保存");
    } finally {
      setSaving(false);
    }
  }

  function chooseModel(choice: string | null) {
    if (!choice) return;
    if (choice === FOLLOW) return void save({ ...settings, provider: null, model: null });
    const [provider, model] = choice.split("::") as [AiProviderId, string];
    void save({ ...settings, provider, model });
  }

  const label = (provider: string | null) => AI_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? provider;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">小欧</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">小欧用的模型（规划、比较、找岗位要多步思考，建议选强一点的；其他功能仍用上面正在使用的模型）</Label>
          <Select value={value} onValueChange={chooseModel} disabled={saving}>
            <SelectTrigger className="w-full">
              <SelectValue>{() => settings.provider ? `${label(settings.provider)} · ${settings.model || "默认模型"}` : `跟随正在使用的模型${current ? `（${current.label} · ${splitModels(current.model)[0] ?? ""}）` : ""}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FOLLOW}>跟随正在使用的模型</SelectItem>
              {configured.map((k) => (
                <SelectGroup key={k.provider}>
                  <SelectLabel>{k.label}</SelectLabel>
                  {Array.from(new Set([...splitModels(k.model), ...SEED_MODELS[k.provider]])).map((model) => (
                    <SelectItem key={model} value={`${k.provider}::${model}`}>{model}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-3">
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={settings.dailyBrief} disabled={saving} onCheckedChange={(checked) => save({ ...settings, dailyBrief: !!checked })} />
            <span><span className="font-medium">每天早上的今日简报</span><span className="block text-xs text-muted-foreground">每天第一次打开总览时，小欧看一遍你的投递和日程，写今天最要紧的事，并给出可以一键执行的操作。</span></span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={settings.weeklyReview} disabled={saving} onCheckedChange={(checked) => save({ ...settings, weeklyReview: !!checked })} />
            <span><span className="font-medium">每周日的周复盘</span><span className="block text-xs text-muted-foreground">周日傍晚（错过了就周一）复盘这一周，并更新下周的求职计划。</span></span>
          </label>
          <p className="text-xs text-muted-foreground">简报只在你打开求职罗盘时写，不会在后台偷偷调用 AI；每次大约调用 3–8 次模型。</p>
        </div>
      </CardContent>
    </Card>
  );
}
