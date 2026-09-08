"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateCoverLetter } from "@/lib/actions/cover-letter";

type ResumeOption = { id: string; name: string };

export function CoverLetterDialog({
  positionId,
  positionLabel,
  resumeVersions,
  defaultResumeVersionId,
  initialResult,
  open,
  onOpenChange,
}: {
  positionId: string;
  positionLabel: string;
  resumeVersions: ResumeOption[];
  defaultResumeVersionId?: string | null;
  initialResult: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [resumeVersionId, setResumeVersionId] = useState(
    defaultResumeVersionId ?? resumeVersions[0]?.id ?? ""
  );
  const [letter, setLetter] = useState<string | null>(initialResult);

  async function run() {
    if (!resumeVersionId) {
      toast.error("先去简历版本页添加一份简历");
      return;
    }
    setLoading(true);
    try {
      const res = await generateCoverLetter(positionId, resumeVersionId);
      if (res.ok) setLetter(res.data);
      else toast.error(res.message);
    } finally {
      setLoading(false);
    }
  }

  async function copyLetter() {
    if (!letter) return;
    try {
      await navigator.clipboard.writeText(letter);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动选中文字复制");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>自荐信</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{positionLabel}</p>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">用哪份简历</label>
          <Select
            value={resumeVersionId}
            onValueChange={(v) => v && setResumeVersionId(v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {() =>
                  resumeVersions.find((r) => r.id === resumeVersionId)?.name ??
                  "选择简历版本"
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

        {!letter ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              结合这个岗位的 JD 和你选的简历，生成一份可以直接改改就用的自荐信草稿。
            </p>
            <Button onClick={run} disabled={loading}>
              <FileText />
              {loading ? "生成中，约需十几秒..." : "生成自荐信"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="whitespace-pre-wrap rounded-lg border p-3 text-sm">{letter}</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={copyLetter}>
                <Copy />
                复制
              </Button>
              <Button variant="outline" size="sm" onClick={run} disabled={loading}>
                {loading ? "重新生成中..." : "重新生成"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              AI 只会用简历里确实有的经历，但投出去前还是自己再读一遍、按自己的语气改改。
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CoverLetterTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <FileText />
      自荐信
    </Button>
  );
}
