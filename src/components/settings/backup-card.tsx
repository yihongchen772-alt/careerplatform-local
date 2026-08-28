"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { exportBackup, previewBackup, importBackup, type ImportPreview } from "@/lib/actions/backup";

export function BackupCard() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastPath, setLastPath] = useState<string | null>(null);
  const [pending, setPending] = useState<{ json: string; preview: ImportPreview } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await exportBackup();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setLastPath(res.data.path);
      toast.success(`已导出（${res.data.sizeMb}MB，含 ${res.data.files} 个文件）`);
    } finally {
      setExporting(false);
    }
  }

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const json = await file.text();
      const res = await previewBackup(json);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setPending({ json, preview: res.data });
    } finally {
      setImporting(false);
    }
  }

  async function handleConfirmImport() {
    if (!pending) return;
    setImporting(true);
    try {
      const res = await importBackup(pending.json);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const parts = [`已恢复 ${res.data.restored} 条数据`];
      if (res.data.skipped > 0) parts.push(`跳过 ${res.data.skipped} 条已损坏/关联缺失的`);
      if (res.data.filesMigrated > 0) parts.push(`搬运了 ${res.data.filesMigrated} 个文件`);
      if (res.data.filesFailed > 0) parts.push(`${res.data.filesFailed} 个文件搬运失败（可能已过期或需要登录，需自己重新上传）`);
      toast.success(`${parts.join("，")}，刷新页面查看`);
      setPending(null);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>备份与恢复</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          所有数据都只存在这台电脑上，没有云端副本——文件损坏或换电脑就没了。导出会把投递记录、
          候选岗位、简历文件、日程等打包成一个 JSON 文件存到「下载」文件夹，换电脑或重装后
          用它恢复。API Key 也在里面（加密状态），备份文件请自己保管好。也可以直接选网页版
          「账号设置 → 导出我的数据」导出的 JSON——数据会正常导入，简历/附件文件会尝试从网页版的
          云端地址下载一份存到本地，失败的（链接过期/需要登录）会保留原样，需要的话请自己重新上传。
        </p>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={handleExport} disabled={exporting}>
              {exporting ? "导出中..." : "导出备份"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => fileInput.current?.click()}
            >
              {importing ? "读取中..." : "从备份恢复"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleFilePicked}
            />
          </div>
          {lastPath && (
            <p className="text-xs break-all text-muted-foreground">已保存到：{lastPath}</p>
          )}
        </div>
      </CardContent>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认恢复这个备份？</AlertDialogTitle>
            <AlertDialogDescription>
              这会清空当前所有数据，换成备份里的内容，无法撤销。
            </AlertDialogDescription>
            {pending && (
              <div className="space-y-1 pt-1 text-sm text-muted-foreground">
                <p>备份时间：{pending.preview.exportedAt.slice(0, 19).replace("T", " ")}</p>
                <p>
                  包含：
                  {pending.preview.counts.map((c) => `${c.label} ${c.n} 条`).join("、") ||
                    "（无业务数据）"}
                  {pending.preview.files > 0 && `，${pending.preview.files} 个文件`}
                </p>
              </div>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={importing}
              onClick={handleConfirmImport}
            >
              {importing ? "恢复中..." : "确认恢复"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
