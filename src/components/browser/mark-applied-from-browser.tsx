"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createApplication } from "@/lib/actions/applications";
import { markPositionApplied } from "@/lib/actions/positions";
import { sourceFromUrl } from "@/components/browser/embedded-browser";

export type PoolPosition = { id: string; label: string; companyName: string; source: string | null };
type ResumeOption = { id: string; name: string; isDefault: boolean };

const NEW = "__new__";

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The step after submitting a 网申: turn the candidate-pool entry into an
 * application, or create one from scratch, without leaving the browser.
 * Guesses the position from the page title (company name match) so the
 * common case is one click.
 */
export function MarkAppliedFromBrowserDialog({
  open,
  onOpenChange,
  pageTitle,
  pageUrl,
  positions,
  resumeVersions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageTitle: string;
  pageUrl: string;
  positions: PoolPosition[];
  resumeVersions: ResumeOption[];
}) {
  const router = useRouter();
  const guessed = positions.find((p) => pageTitle && pageTitle.includes(p.companyName));
  const [positionId, setPositionId] = useState(guessed?.id ?? (positions[0]?.id ?? NEW));
  const [companyName, setCompanyName] = useState("");
  const [title, setTitle] = useState("");
  const [appliedDate, setAppliedDate] = useState(todayKey);
  const [source, setSource] = useState(sourceFromUrl(pageUrl));
  const [resumeVersionId, setResumeVersionId] = useState(
    resumeVersions.find((r) => r.isDefault)?.id ?? resumeVersions[0]?.id ?? ""
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (positionId === NEW) {
        if (!companyName.trim() || !title.trim()) {
          toast.error("公司和岗位必填");
          return;
        }
        await createApplication({
          companyName: companyName.trim(),
          title: title.trim(),
          appliedDate: new Date(appliedDate),
          source: source || undefined,
          resumeVersionId: resumeVersionId || undefined,
        });
      } else {
        await markPositionApplied(positionId, {
          appliedDate: new Date(appliedDate),
          resumeVersionId: resumeVersionId || undefined,
        });
      }
      toast.success("已记为投递，看板里能看到了");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>记为已投递</DialogTitle>
          <DialogDescription>网申提交完了，顺手把它记进投递记录。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">投的是候选池里的哪个岗位</Label>
            <Select value={positionId} onValueChange={(v) => v && setPositionId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) => (value === NEW ? "不在候选池里，新建一条" : (positions.find((p) => p.id === value)?.label ?? "选岗位"))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {positions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value={NEW}>不在候选池里，新建一条</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {positionId === NEW && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">公司 *</Label>
                <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="从页面标题看是哪家" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">岗位 *</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">投递日期</Label>
              <Input type="date" value={appliedDate} onChange={(e) => setAppliedDate(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">渠道</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
          </div>
          {resumeVersions.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">用的简历</Label>
              <Select value={resumeVersionId} onValueChange={(v) => setResumeVersionId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(value: string) => resumeVersions.find((r) => r.id === value)?.name ?? "选简历"}</SelectValue>
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
              {loading ? "保存中..." : "记为已投递"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
