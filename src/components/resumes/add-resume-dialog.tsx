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
import { createResumeVersion } from "@/lib/actions/resumes";

export function AddResumeDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [targetTrack, setTargetTrack] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) {
      toast.error("版本名称必填");
      return;
    }
    setLoading(true);
    try {
      await createResumeVersion({
        name,
        fileUrl: file?.url,
        targetTrack: targetTrack || undefined,
      });
      toast.success("已添加简历版本");
      setName("");
      setFile(null);
      setTargetTrack("");
      setOpen(false);
    } catch {
      toast.error("添加失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>+ 添加简历版本</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加简历版本</DialogTitle>
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
            <Label className="text-xs text-muted-foreground">简历文件（PDF/图片，10MB 内）</Label>
            <div className="flex items-center gap-2">
              <FileUploadButton
                label={file ? "重新上传" : "选择文件"}
                onUploaded={(f) => setFile(f)}
              />
              {file && (
                <span className="text-sm text-muted-foreground truncate">
                  {file.name}
                </span>
              )}
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
