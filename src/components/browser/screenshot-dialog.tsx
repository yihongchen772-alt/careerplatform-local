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

export type ApplicationOption = { id: string; label: string; companyName: string };

/** Files a page screenshot (投递成功页, 测评说明…) as an attachment on an application. */
export function ScreenshotDialog({
  open,
  onOpenChange,
  shot,
  applications,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shot: { dataUrl: string; title: string };
  applications: ApplicationOption[];
}) {
  const router = useRouter();
  const guessed = applications.find((a) => shot.title && shot.title.includes(a.companyName));
  const [applicationId, setApplicationId] = useState(guessed?.id ?? applications[0]?.id ?? "");
  const [name, setName] = useState(() => {
    const date = new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
    return `${shot.title || "网申页面"} ${date}`.slice(0, 100);
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!applicationId || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/desktop-browser/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: shot.dataUrl, applicationId, name }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "保存失败");
      toast.success("截图已存到这条投递的附件里");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>截图存到投递附件</DialogTitle>
          <DialogDescription>投递成功页、测评说明、笔试时间——存到对应投递记录里，以后找得到。</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.dataUrl} alt="页面截图" className="max-h-64 w-full object-contain object-top" />
        </div>
        {applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有进行中的投递记录，先「记为已投递」再截图。</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">存到哪条投递</Label>
              <Select value={applicationId} onValueChange={(v) => v && setApplicationId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(value: string) => applications.find((a) => a.id === value)?.label ?? "选投递"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {applications.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">文件名</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" disabled={!applicationId || saving || !name.trim()} onClick={handleSave}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
