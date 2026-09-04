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
import { updateApplication } from "@/lib/actions/applications";
import { toDateKey } from "@/lib/dates";

type ResumeOption = { id: string; name: string };

export function ApplicationEditForm({
  applicationId,
  initial,
  resumeVersions,
}: {
  applicationId: string;
  initial: {
    appliedDate: Date;
    referrer: string | null;
    source: string | null;
    resumeVersionId: string | null;
  };
  resumeVersions: ResumeOption[];
}) {
  const [appliedDate, setAppliedDate] = useState(toDateKey(initial.appliedDate));
  const [referrer, setReferrer] = useState(initial.referrer ?? "");
  const [source, setSource] = useState(initial.source ?? "");
  const [resumeVersionId, setResumeVersionId] = useState(initial.resumeVersionId ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await updateApplication(applicationId, {
        appliedDate: new Date(appliedDate),
        referrer: referrer || undefined,
        source: source || undefined,
        resumeVersionId: resumeVersionId || null,
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
        <CardTitle>投递信息</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">投递日期</Label>
              <Input
                type="date"
                value={appliedDate}
                onChange={(e) => setAppliedDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">渠道</Label>
              <Input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="官网 / 内推 / 猎头..."
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">内推人</Label>
              <Input value={referrer} onChange={(e) => setReferrer(e.target.value)} />
            </div>
            {resumeVersions.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">简历版本</Label>
                <Select
                  value={resumeVersionId}
                  onValueChange={(value) => setResumeVersionId(value ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="未指定">
                      {(value: string) =>
                        resumeVersions.find((r) => r.id === value)?.name ?? "未指定"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {resumeVersions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <Button type="submit" size="sm" disabled={loading}>
            {loading ? "保存中..." : "保存"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
