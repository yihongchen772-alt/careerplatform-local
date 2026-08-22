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
  initial: { salaryMin: number | null; salaryMax: number | null; offerNote: string | null };
}) {
  const [salaryMin, setSalaryMin] = useState(initial.salaryMin?.toString() ?? "");
  const [salaryMax, setSalaryMax] = useState(initial.salaryMax?.toString() ?? "");
  const [offerNote, setOfferNote] = useState(initial.offerNote ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await updateApplicationOffer(applicationId, {
        salaryMin: salaryMin ? Number(salaryMin) : undefined,
        salaryMax: salaryMax ? Number(salaryMax) : undefined,
        offerNote: offerNote || undefined,
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
        <CardTitle>薪资 / Offer 备注</CardTitle>
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
