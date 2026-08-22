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
import { FileUploadButton } from "@/components/ui/file-upload-button";
import { updateResumeVersion } from "@/lib/actions/resumes";

export function EditResumeDialog({
  resumeVersionId,
  initialName,
  initialTargetTrack,
  initialFileUrl,
  trigger,
}: {
  resumeVersionId: string;
  initialName: string;
  initialTargetTrack: string | null;
  initialFileUrl: string | null;
  trigger: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(initialName);
  const [targetTrack, setTargetTrack] = useState(initialTargetTrack ?? "");
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);

  function handleOpenChange(next: boolean) {
    if (next) {
      setName(initialName);
      setTargetTrack(initialTargetTrack ?? "");
      setFile(null);
    }
    setOpen(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) {
      toast.error("版本名称必填");
      return;
    }
    setLoading(true);
    try {
      await updateResumeVersion(resumeVersionId, {
        name,
        fileUrl: file?.url ?? initialFileUrl ?? undefined,
        targetTrack: targetTrack || undefined,
      });
      toast.success("已保存");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑简历版本</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">版本名称 *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="v2 - 算法岗定制版"
              required
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">目标方向</Label>
            <Input
              value={targetTrack}
              onChange={(e) => setTargetTrack(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              简历文件（PDF/图片，10MB 内）
            </Label>
            <div className="flex items-center gap-2">
              <FileUploadButton
                label={file || initialFileUrl ? "重新上传" : "选择文件"}
                onUploaded={(f) => setFile(f)}
              />
              <span className="truncate text-sm text-muted-foreground">
                {file
                  ? file.name
                  : initialFileUrl
                    ? "已有文件，重新上传会替换"
                    : "尚未上传"}
              </span>
            </div>
          </div>
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
