"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Radar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { researchCompanyInsight, type CompanyInsight } from "@/lib/actions/company-insight";

const CONFIDENCE = {
  high: { label: "可信度较高", variant: "default" as const },
  medium: { label: "可信度中等", variant: "secondary" as const },
  low: { label: "几乎没查到", variant: "outline" as const },
};

export function CompanyInsightDialog({
  positionId,
  positionLabel,
  open,
  onOpenChange,
}: {
  positionId: string;
  positionLabel: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompanyInsight | null>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await researchCompanyInsight(positionId);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setResult(res.data);
    } finally {
      setLoading(false);
    }
  }

  const sections: [string, string | null | undefined][] = result
    ? [
        ["薪资水平", result.salary],
        ["加班 / 作息", result.workLife],
        ["面试流程和难度", result.interview],
        ["团队氛围 / 成长", result.culture],
        ["最近动态", result.recent],
      ]
    : [];
  const found = sections.filter(([, v]) => v);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>岗位口碑 · {positionLabel}</DialogTitle>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              让 AI 联网搜一下这个岗位的真实情况：薪资水平、加班作息、面试难度、团队氛围、
              最近动态。
            </p>
            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              信息来自公开网页（新闻、知乎、脉脉、看准，以及被搜索引擎收录的小红书内容）。
              大部分是匿名爆料和个人分享，样本少、主观性强，只能当参考，不能当事实。查不到的
              会如实说查不到，不会拿同类公司的印象凑数。
            </p>
            <Button type="button" onClick={run} disabled={loading}>
              <Radar />
              {loading ? "联网搜索中，约需二十几秒..." : "开始调研"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={CONFIDENCE[result.confidence].variant}>
                {CONFIDENCE[result.confidence].label}
              </Badge>
              <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={run}>
                {loading ? "重新搜索中..." : "重新调研"}
              </Button>
            </div>

            {found.length === 0 ? (
              <p className="rounded-md border p-4 text-sm text-muted-foreground">
                没查到这个岗位的具体信息。冷门公司或新岗位很常见——建议直接问学长学姐，或者
                去公司官网/招聘公众号看官方说明。
              </p>
            ) : (
              found.map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{value}</p>
                </div>
              ))
            )}

            {sections.some(([, v]) => !v) && found.length > 0 && (
              <p className="text-xs text-muted-foreground">
                没查到：{sections.filter(([, v]) => !v).map(([k]) => k).join("、")}
              </p>
            )}

            <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {result.caveat}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CompanyInsightTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      岗位口碑
    </Button>
  );
}
