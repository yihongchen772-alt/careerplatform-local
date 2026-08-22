"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createApplication } from "@/lib/actions/applications";
import {
  LAST_REFERRER_KEY,
  LAST_SOURCE_KEY,
  rememberValue,
  recallValue,
} from "@/lib/remembered-values";
import { todayKey } from "@/lib/dates";

type ResumeOption = { id: string; name: string };

export function AddApplicationDialog({
  resumeVersions = [],
  defaultResumeVersionId,
}: {
  resumeVersions?: ResumeOption[];
  defaultResumeVersionId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resumeVersionId, setResumeVersionId] = useState(
    defaultResumeVersionId ?? ""
  );
  const [companyName, setCompanyName] = useState("");
  const [title, setTitle] = useState("");
  // Empty until the dialog opens. This component renders on the server (its
  // trigger button is always on the page), and the local clock and localStorage
  // exist only in the browser — reading them in the initializer would desync the
  // server HTML from the first client render. Filling them on open also re-reads
  // what another form just remembered, and keeps "today" right past midnight.
  const [appliedDate, setAppliedDate] = useState("");
  const [referrer, setReferrer] = useState("");
  const [source, setSource] = useState("");

  function handleOpenChange(next: boolean) {
    if (next) {
      setAppliedDate(todayKey());
      setReferrer(recallValue(LAST_REFERRER_KEY));
      setSource(recallValue(LAST_SOURCE_KEY));
    }
    setOpen(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyName || !title) {
      toast.error("公司名称和岗位名称必填");
      return;
    }
    setLoading(true);
    try {
      await createApplication({
        companyName,
        title,
        appliedDate: new Date(appliedDate),
        referrer: referrer || undefined,
        source: source || undefined,
        resumeVersionId: resumeVersionId || undefined,
      });
      rememberValue(LAST_REFERRER_KEY, referrer);
      rememberValue(LAST_SOURCE_KEY, source);
      toast.success("已新增投递记录");
      setCompanyName("");
      setTitle("");
      setOpen(false);
    } catch {
      toast.error("新增失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button>+ 新增投递记录</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增投递记录</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">公司名称 *</Label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">岗位名称 *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
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
            <Label className="text-xs text-muted-foreground">内推人（可选）</Label>
            <Input value={referrer} onChange={(e) => setReferrer(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">渠道</Label>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="官网 / 内推 / 猎头..."
            />
          </div>
          {resumeVersions.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">使用的简历版本</Label>
              <Select
                value={resumeVersionId}
                onValueChange={(v) => setResumeVersionId(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择简历版本（可选）">
                    {(value: string) =>
                      resumeVersions.find((r) => r.id === value)?.name ??
                      "选择简历版本（可选）"
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
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
