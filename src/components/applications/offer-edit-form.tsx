"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateApplicationOffer } from "@/lib/actions/applications";

export function OfferEditForm({
  applicationId,
  initial,
}: {
  applicationId: string;
  initial: {
    salaryMin: number | null;
    salaryMax: number | null;
    offerNote: string | null;
    offerAnnualTotal: number | null;
    commuteMinutes: number | null;
    overtimeNote: string | null;
    growthNote: string | null;
  };
}) {
  const [salaryMin, setSalaryMin] = useState(initial.salaryMin?.toString() ?? "");
  const [salaryMax, setSalaryMax] = useState(initial.salaryMax?.toString() ?? "");
  const [offerNote, setOfferNote] = useState(initial.offerNote ?? "");
  const [annualTotal, setAnnualTotal] = useState(initial.offerAnnualTotal?.toString() ?? "");
  const [commute, setCommute] = useState(initial.commuteMinutes?.toString() ?? "");
  const [overtime, setOvertime] = useState(initial.overtimeNote ?? "");
  const [growth, setGrowth] = useState(initial.growthNote ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await updateApplicationOffer(applicationId, {
        salaryMin: salaryMin ? Number(salaryMin) : undefined,
        salaryMax: salaryMax ? Number(salaryMax) : undefined,
        offerNote: offerNote || undefined,
        offerAnnualTotal: annualTotal ? Number(annualTotal) : null,
        commuteMinutes: commute ? Number(commute) : null,
        overtimeNote: overtime || undefined,
        growthNote: growth || undefined,
      });
      toast.success("已保存");
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>薪资 / Offer 详情</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">薪资下限（K）</Label>
              <Input
                type="number"
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">薪资上限（K）</Label>
              <Input
                type="number"
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">年包（万）</Label>
              <Input
                type="number"
                value={annualTotal}
                onChange={(e) => setAnnualTotal(e.target.value)}
                placeholder="含奖金/股票"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">单程通勤（分钟）</Label>
              <Input
                type="number"
                value={commute}
                onChange={(e) => setCommute(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">加班情况</Label>
            <Input
              value={overtime}
              onChange={(e) => setOvertime(e.target.value)}
              placeholder="大小周 / 弹性 / 旺季封闭一个月"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">发展空间</Label>
            <Input
              value={growth}
              onChange={(e) => setGrowth(e.target.value)}
              placeholder="团队、mentor、技术栈、晋升路径"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">备注</Label>
            <Textarea
              value={offerNote}
              onChange={(e) => setOfferNote(e.target.value)}
              rows={2}
              placeholder="团队氛围、成长性之类的想法"
            />
          </div>
          <Button type="submit" size="sm" disabled={loading}>
            {loading ? "保存中..." : "保存"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
