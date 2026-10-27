"use client";

import { useRef, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { IMPORT_STAGE_LABELS, type ImportedApplication } from "@/lib/application-import";
import { importApplications, undoImportApplications } from "@/lib/actions/import-applications";

type Sheet = { rows: ImportedApplication[]; skipped: number; truncated: boolean };

/**
 * 把自己的投递表格导进来: the Excel most people already keep. Preview first,
 * then one click, and 撤销 in the toast takes the whole import back.
 */
export function ImportApplicationsDialog({ trigger }: { trigger?: ReactElement }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setSheet(null);
    setChecked(new Set());
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setParsing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/import/applications", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) return void toast.error(data?.error ?? "解析失败");
      setSheet(data as Sheet);
      setChecked(new Set((data as Sheet).rows.map((_, index) => index)));
    } catch {
      toast.error("解析失败，请检查文件格式");
    } finally {
      setParsing(false);
    }
  }

  function toggle(index: number) {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleImport() {
    if (!sheet) return;
    const picked = sheet.rows.filter((_, index) => checked.has(index));
    setImporting(true);
    try {
      const result = await importApplications(picked);
      if (!result.ok) return void toast.error(result.message);
      const { applicationIds, companyIds, skipped } = result.data;
      router.refresh();
      reset();
      setOpen(false);
      toast.success(
        applicationIds.length
          ? `已导入 ${applicationIds.length} 条投递${skipped ? `（${skipped} 条已经有了，跳过）` : ""}`
          : "这些投递都已经在里面了，没有新增",
        applicationIds.length
          ? {
              duration: 15000,
              action: {
                label: "撤销",
                onClick: async () => {
                  const undone = await undoImportApplications(applicationIds, companyIds);
                  if (!undone.ok) toast.error(undone.message);
                  else { toast.success(`已撤销，删除了 ${undone.data.removed} 条`); router.refresh(); }
                },
              },
            }
          : undefined
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); setOpen(next); }}>
      <DialogTrigger render={trigger ?? <Button variant="outline"><Upload />导入我的投递表格</Button>} />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>导入我的投递表格</DialogTitle>
          <DialogDescription>你已经在用 Excel 记投递的话，选那个文件就行，不用重新一条条填。</DialogDescription>
        </DialogHeader>
        {!sheet ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Excel（.xlsx）或 CSV，第一行是表头。认得这些列：<b className="font-medium text-foreground">公司</b>（必须有）、岗位、城市、投递日期、状态、渠道、备注、链接。
              状态写「一面」「笔试」「挂了」「offer」这样的字都行，会自动对应到进度；写「待投」的行会跳过。
            </p>
            <p className="text-muted-foreground">飞书 / 腾讯文档里的表格，先在原平台「导出为 Excel」再选文件。已经在软件里的同一公司同一岗位不会重复添加。</p>
            <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden" onChange={handleFile} />
            <Button type="button" disabled={parsing} onClick={() => fileInput.current?.click()}>{parsing ? "读取中…" : "选择文件"}</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              读到 {sheet.rows.length} 条投递，已选 {checked.size} 条。取消勾选不想导入的。
              {sheet.skipped > 0 && `另有 ${sheet.skipped} 行是还没投的或重复的，已跳过。`}
              {sheet.truncated && "表格很长，只取了前面一部分。"}
            </p>
            <div className="max-h-[48vh] space-y-1.5 overflow-y-auto pr-1">
              {sheet.rows.map((row, index) => (
                <label key={index} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50">
                  <Checkbox className="mt-0.5" checked={checked.has(index)} onCheckedChange={() => toggle(index)} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      <span className="[overflow-wrap:anywhere]">{row.companyName} · {row.title}</span>
                      <Badge variant={row.stage === "REJECTED" || row.stage === "WITHDRAWN" ? "outline" : row.stage === "OFFER" || row.stage === "ACCEPTED" ? "default" : "secondary"}>{IMPORT_STAGE_LABELS[row.stage]}</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[row.city, row.appliedDate ? `投递 ${row.appliedDate}` : "没写投递日期，按今天", row.statusText && row.statusText !== IMPORT_STAGE_LABELS[row.stage] ? `表里写的「${row.statusText}」` : null, row.source].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
        {sheet && (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={reset} disabled={importing}>重新选文件</Button>
            <Button type="button" onClick={handleImport} disabled={importing || checked.size === 0}>{importing ? "导入中…" : `导入 ${checked.size} 条`}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
