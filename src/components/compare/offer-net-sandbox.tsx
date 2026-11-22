"use client";

import { useMemo, useState } from "react";
import { Calculator, Clock, Plus, Trash2, Trophy, CalendarClock, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  CITY_LIVING_PRESETS,
  calculateOfferEconomics,
  findCityPreset,
  type DegreeLevel,
  type OfferCalcInput,
} from "@/lib/offer-calculator";
import { cn } from "@/lib/utils";

export type OfferSandboxSeed = {
  id: string;
  companyName: string;
  title: string;
  city: string;
  salaryK: number | null;
  annualTotalW: number | null;
  commuteMinutes: number | null;
  decideBy: string | null;
};

function seedToInput(seed: OfferSandboxSeed, degree: DegreeLevel): OfferCalcInput {
  const preset = findCityPreset(seed.city);
  const monthlyBase = seed.salaryK ? seed.salaryK * 1000 : seed.annualTotalW ? Math.round((seed.annualTotalW * 10000) / 15) : 22000;
  const months = seed.annualTotalW && monthlyBase > 0 ? Math.max(12, Math.min(24, Math.round((seed.annualTotalW * 10000) / monthlyBase))) : 15;
  return {
    id: seed.id,
    companyName: seed.companyName,
    title: seed.title,
    city: preset.city,
    monthlyBase,
    months,
    signOnBonus: 0,
    housingFundRate: 0.12,
    monthlyDeduction: 1500,
    monthlyRent: preset.typicalRentMonthly,
    talentSubsidy: preset.firstYearSubsidy[degree],
    weeklyHours: 48,
    commuteMinutes: seed.commuteMinutes ?? 35,
    decideBy: seed.decideBy,
    penaltyRmb: 5000,
  };
}

function wan(rmb: number): string {
  return `${(rmb / 10000).toFixed(2)} 万`;
}

export function OfferNetSandbox({ seeds }: { seeds: OfferSandboxSeed[] }) {
  const [degree, setDegree] = useState<DegreeLevel>("master");
  const [nowMs] = useState(() => Date.now());
  const [items, setItems] = useState<OfferCalcInput[]>(() => {
    if (seeds.length > 0) return seeds.map((s) => seedToInput(s, "master"));
    return [
      seedToInput({ id: "demo-1", companyName: "方案 A（示例）", title: "算法/研发", city: "上海", salaryK: 26, annualTotalW: 39, commuteMinutes: 45, decideBy: null }, "master"),
      seedToInput({ id: "demo-2", companyName: "方案 B（示例）", title: "算法/研发", city: "杭州", salaryK: 24, annualTotalW: 36, commuteMinutes: 25, decideBy: null }, "master"),
    ];
  });

  function applyDegreePreset(next: DegreeLevel) {
    setDegree(next);
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        talentSubsidy: findCityPreset(item.city).firstYearSubsidy[next],
      }))
    );
  }

  function updateItem(id: string, patch: Partial<OfferCalcInput>) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const merged = { ...item, ...patch };
        if (patch.city && patch.city !== item.city) {
          const preset = findCityPreset(patch.city);
          merged.monthlyRent = preset.typicalRentMonthly;
          merged.talentSubsidy = preset.firstYearSubsidy[degree];
        }
        return merged;
      })
    );
  }

  function addSandboxOffer() {
    const preset = findCityPreset("杭州");
    setItems((prev) => [
      ...prev,
      {
        id: `sim-${Date.now()}`,
        companyName: `备选 Offer ${prev.length + 1}`,
        title: "目标岗位",
        city: preset.city,
        monthlyBase: 22000,
        months: 15,
        signOnBonus: 0,
        housingFundRate: 0.12,
        monthlyDeduction: 1500,
        monthlyRent: preset.typicalRentMonthly,
        talentSubsidy: preset.firstYearSubsidy[degree],
        weeklyHours: 48,
        commuteMinutes: 30,
        decideBy: null,
        penaltyRmb: 5000,
      },
    ]);
  }

  const computed = useMemo(
    () => items.map((input) => ({ input, result: calculateOfferEconomics(input) })),
    [items]
  );

  const bestDisposableId = useMemo(() => {
    if (computed.length < 2) return null;
    return [...computed].sort((a, b) => b.result.realDisposablePlusFund - a.result.realDisposablePlusFund)[0]?.input.id ?? null;
  }, [computed]);

  const bestHourlyId = useMemo(() => {
    if (computed.length < 2) return null;
    return [...computed].sort((a, b) => b.result.effectiveHourlyRate - a.result.effectiveHourlyRate)[0]?.input.id ?? null;
  }, [computed]);

  const timelineOffers = useMemo(() => {
    return items
      .filter((i) => i.decideBy)
      .map((i) => {
        const ts = new Date(i.decideBy!).getTime();
        const daysLeft = Number.isNaN(ts) ? null : Math.ceil((ts - nowMs) / 86_400_000);
        return { ...i, ts, daysLeft };
      })
      .filter((i) => i.daysLeft !== null)
      .sort((a, b) => a.ts - b.ts);
  }, [items, nowMs]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="size-4 text-primary" />
            税后真实净结余 & 城市人才补贴 + 三方时间线沙盘
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            自动按 2026 个税（年终奖单独计税 vs 并入综合所得择优）、五险一金封顶基数、应届生城市生活/租房补贴、房租和通勤工时算出真实到手与时薪。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
            {([["bachelor", "本科"], ["master", "硕士"], ["phd", "博士"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyDegreePreset(key)}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  degree === key ? "bg-card font-medium text-primary shadow-2xs" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={addSandboxOffer}>
            <Plus className="size-3.5" />
            加一个测算方案
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {computed.map(({ input, result }) => {
            const isBestTotal = bestDisposableId === input.id;
            const isBestHourly = bestHourlyId === input.id;
            const preset = findCityPreset(input.city);
            return (
              <div
                key={input.id}
                className={cn(
                  "space-y-3 rounded-xl border p-3.5",
                  isBestTotal ? "border-primary/40 bg-primary/[0.02]" : "bg-card/60"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Input
                      value={input.companyName}
                      onChange={(e) => updateItem(input.id, { companyName: e.target.value })}
                      className="h-8 max-w-[180px] text-sm font-semibold"
                    />
                    <select
                      aria-label="选择城市"
                      value={CITY_LIVING_PRESETS.some((c) => c.city === input.city) ? input.city : "北京"}
                      onChange={(e) => updateItem(input.id, { city: e.target.value })}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      {CITY_LIVING_PRESETS.map((c) => (
                        <option key={c.city} value={c.city}>{c.city}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isBestTotal && <Badge className="gap-1 text-[10px]"><Trophy className="size-2.5" />净结余最高</Badge>}
                    {isBestHourly && <Badge variant="secondary" className="gap-1 text-[10px]"><Clock className="size-2.5" />时薪最高</Badge>}
                    {items.length > 1 && (
                      <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => setItems((prev) => prev.filter((x) => x.id !== input.id))}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Editable economic knobs */}
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <label className="space-y-1">
                    <span className="text-muted-foreground">月薪 (元)</span>
                    <Input type="number" step={1000} value={input.monthlyBase} onChange={(e) => updateItem(input.id, { monthlyBase: Number(e.target.value) || 0 })} className="h-7 text-xs" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">年薪月数</span>
                    <Input type="number" step={0.5} min={12} max={24} value={input.months} onChange={(e) => updateItem(input.id, { months: Number(e.target.value) || 12 })} className="h-7 text-xs" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">签字费/首年补贴(元)</span>
                    <Input type="number" step={5000} value={input.signOnBonus} onChange={(e) => updateItem(input.id, { signOnBonus: Number(e.target.value) || 0 })} className="h-7 text-xs" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">公积金比例(%)</span>
                    <Input type="number" min={5} max={12} value={Math.round(input.housingFundRate * 100)} onChange={(e) => updateItem(input.id, { housingFundRate: (Number(e.target.value) || 5) / 100 })} className="h-7 text-xs" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">月房租 (元)</span>
                    <Input type="number" step={200} value={input.monthlyRent} onChange={(e) => updateItem(input.id, { monthlyRent: Number(e.target.value) || 0 })} className="h-7 text-xs" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">城市人才补贴(元)</span>
                    <Input type="number" step={1000} value={input.talentSubsidy} onChange={(e) => updateItem(input.id, { talentSubsidy: Number(e.target.value) || 0 })} className="h-7 text-xs" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">周工时 (小时)</span>
                    <Input type="number" min={35} max={80} value={input.weeklyHours} onChange={(e) => updateItem(input.id, { weeklyHours: Number(e.target.value) || 40 })} className="h-7 text-xs" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">单程通勤(分钟)</span>
                    <Input type="number" min={0} max={180} value={input.commuteMinutes} onChange={(e) => updateItem(input.id, { commuteMinutes: Number(e.target.value) || 0 })} className="h-7 text-xs" />
                  </label>
                </div>

                {/* Output Summary Grid */}
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/45 p-2.5 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">税前年包</p>
                    <p className="mt-0.5 font-semibold">{wan(result.grossAnnual)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">税后年现金</p>
                    <p className="mt-0.5 font-semibold text-foreground">{wan(result.netCashAnnual)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">双边公积金</p>
                    <p className="mt-0.5 font-semibold text-emerald-600 dark:text-emerald-400">+{wan(result.totalHousingFundAnnual)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">真实时薪</p>
                    <p className="mt-0.5 font-semibold text-primary">¥{result.effectiveHourlyRate}/时</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>
                    扣租房+含补贴+双边公积金 真实年结余：
                    <strong className="ml-1 text-sm text-primary">{wan(result.realDisposablePlusFund)}</strong>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    个税 {wan(result.incomeTaxAnnual)}（{result.taxStrategy}）
                  </span>
                </div>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Sparkles className="size-3 shrink-0 text-primary/70" />
                  {input.city}参考：{preset.subsidyNote}
                </p>

                {/* Optional deadline + tripartite penalty for timeline sandbox */}
                <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
                  <span className="text-muted-foreground">三方/截止日：</span>
                  <Input
                    type="date"
                    value={input.decideBy ?? ""}
                    onChange={(e) => updateItem(input.id, { decideBy: e.target.value || null })}
                    className="h-7 w-36 text-xs"
                  />
                  <span className="text-muted-foreground">违约金(元)：</span>
                  <Input
                    type="number"
                    step={1000}
                    value={input.penaltyRmb ?? 5000}
                    onChange={(e) => updateItem(input.id, { penaltyRmb: Number(e.target.value) || 0 })}
                    className="h-7 w-24 text-xs"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Tripartite / Offer Decision Timeline Sandbox */}
        {timelineOffers.length > 0 && (
          <div className="space-y-2 rounded-xl border bg-muted/25 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <CalendarClock className="size-3.5 text-primary" />
              三方与 Offer 决策截止时间线沙盘
            </p>
            <div className="flex flex-wrap gap-2">
              {timelineOffers.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs">
                  <span className="font-semibold">{item.companyName}</span>
                  <span className="text-muted-foreground">{item.decideBy}</span>
                  <Badge variant={(item.daysLeft ?? 99) <= 3 ? "destructive" : (item.daysLeft ?? 99) <= 7 ? "default" : "secondary"}>
                    {(item.daysLeft ?? 0) < 0 ? `已过 ${Math.abs(item.daysLeft!)} 天` : `剩 ${item.daysLeft} 天`}
                  </Badge>
                  {!!item.penaltyRmb && (
                    <span className="text-[11px] text-muted-foreground">违约金 ¥{item.penaltyRmb}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
