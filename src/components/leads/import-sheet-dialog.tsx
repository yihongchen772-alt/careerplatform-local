"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  parseRecruitmentSheet,
  parseRecruitmentText,
  parseRecruitmentScreenshot,
  importLeads,
  rankImportedPositions,
  type ImportedPosition,
  type PositionFit,
} from "@/lib/actions/import-positions";

export function ImportSheetDialog({
  resumeVersions,
  defaultResumeVersionId,
}: {
  resumeVersions: { id: string; name: string }[];
  defaultResumeVersionId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [rows, setRows] = useState<ImportedPosition[] | null>(null);
  const [fits, setFits] = useState<Map<number, PositionFit>>(new Map());
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [truncated, setTruncated] = useState(false);
  const [batch, setBatch] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);

  const resumeId = defaultResumeVersionId ?? resumeVersions[0]?.id ?? null;

  function reset() {
    setRows(null);
    setChecked(new Set());
    setFits(new Map());
    setTruncated(false);
    setBatch(null);
    setPasted("");
  }

  function applyParsed(positions: ImportedPosition[], wasTruncated: boolean, label: string) {
    setRows(positions);
    setChecked(new Set(positions.map((_, i) => i)));
    setTruncated(wasTruncated);
    setBatch(label);
    toast.success(`认出 ${positions.length} 个岗位，确认后再导入`);
  }

  async function handlePaste() {
    if (!pasted.trim()) {
      toast.error("先粘贴一段内容");
      return;
    }
    setParsing(true);
    try {
      const res = await parseRecruitmentText(pasted);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      applyParsed(res.data.positions, res.data.truncated, "粘贴的内容");
    } finally {
      setParsing(false);
    }
  }

  async function handleRank() {
    if (!rows || !resumeId) return;
    setRanking(true);
    try {
      const res = await rankImportedPositions(rows, resumeId);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setFits(new Map(res.data.map((f) => [f.index, f])));
      toast.success("已按你的简历打分，分低的可以取消勾选");
    } finally {
      setRanking(false);
    }
  }

  async function toBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // btoa can't take the whole buffer at once for large files; chunk it.
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  async function handleScreenshot(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setParsing(true);
    try {
      const res = await parseRecruitmentScreenshot(await toBase64(file), file.name);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      applyParsed(res.data.positions, res.data.truncated, file.name);
    } finally {
      setParsing(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setParsing(true);
    try {
      const res = await parseRecruitmentSheet(await toBase64(file), file.name);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      applyParsed(res.data.positions, res.data.truncated, file.name);
    } finally {
      setParsing(false);
    }
  }

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleImport() {
    if (!rows) return;
    // Carry any fit score the user just computed through to the library, so
    // they don't have to re-run the match after importing.
    const selected = rows
      .map((r, i) => ({ ...r, fitScore: fits.get(i)?.fitScore ?? null, fitReason: fits.get(i)?.reason ?? null, i }))
      .filter((r) => checked.has(r.i));
    setImporting(true);
    try {
      const res = await importLeads(selected, batch ?? undefined);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        res.data.skipped > 0
          ? `已加入信息库 ${res.data.created} 个（跳过 ${res.data.skipped} 个重复或信息不全的）`
          : `已加入信息库 ${res.data.created} 个岗位`
      );
      reset();
      setOpen(false);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        setOpen(o);
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <Upload />
            导入信息表
          </Button>
        }
      />
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>导入秋招信息表</DialogTitle>
        </DialogHeader>

        {!rows ? (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">方式一：传表格文件</p>
              <p className="text-sm text-muted-foreground">
                Excel（.xlsx）或 CSV。飞书/腾讯文档的表格先在原平台「导出为 Excel/CSV」再选文件
                ——分享链接需要登录，App 读不到。
              </p>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt"
                className="hidden"
                onChange={handleFile}
              />
              <Button type="button" disabled={parsing} onClick={() => fileInput.current?.click()}>
                {parsing ? "AI 解析中..." : "选择文件"}
              </Button>
            </div>

            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">方式二：直接粘贴文字</p>
              <p className="text-sm text-muted-foreground">
                在小红书 / 公众号 / 群里看到的招聘信息，整段复制粘贴进来就行，格式乱也没关系，
                AI 会挑出里面的岗位，闲聊和广告会自动忽略。
              </p>
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={6}
                placeholder="把小红书笔记 / 招聘推文 / 群消息整段粘到这里…"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={parsing || !pasted.trim()}
                onClick={handlePaste}
              >
                {parsing ? "AI 解析中..." : "解析这段文字"}
              </Button>
            </div>

            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">方式三：传截图</p>
              <p className="text-sm text-muted-foreground">
                手机上刷到的招聘帖直接截图发过来，AI 会读图里的文字。图里没有的信息不会瞎猜，
                看不清就留空。需要配 Gemini/Claude/OpenAI 的 Key（这三家能看图）。
              </p>
              <input
                ref={imgInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleScreenshot}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={parsing}
                onClick={() => imgInput.current?.click()}
              >
                {parsing ? "AI 读图中..." : "选择截图"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                认出 {rows.length} 个岗位，已选 {checked.size} 个。取消勾选不想导入的。
              </p>
              <div className="flex items-center gap-2">
                {resumeId && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={ranking}
                    onClick={handleRank}
                  >
                    {ranking ? "匹配中..." : fits.size ? "重新匹配" : "按我的简历匹配"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setChecked(
                      checked.size === rows.length ? new Set() : new Set(rows.map((_, i) => i))
                    )
                  }
                >
                  {checked.size === rows.length ? "全不选" : "全选"}
                </Button>
              </div>
            </div>

            {!resumeId && (
              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                还没有简历，所以没法按简历匹配。先去简历版本页上传一份并跑一次「AI 体检」。
              </p>
            )}

            {truncated && (
              <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                表格内容较长，只解析了前面一部分。剩下的可以删掉已导入的行后再传一次。
              </p>
            )}

            <div className="space-y-1.5">
              {rows
                .map((r, i) => ({ r, i }))
                // Once scored, put the best matches first so the user reads
                // the ones worth applying to before the noise.
                .sort((a, b) =>
                  fits.size
                    ? (fits.get(b.i)?.fitScore ?? -1) - (fits.get(a.i)?.fitScore ?? -1)
                    : 0
                )
                .map(({ r, i }) => {
                  const fit = fits.get(i);
                  return (
                    <label
                      key={i}
                      className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={checked.has(i)}
                        onCheckedChange={() => toggle(i)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <span>
                            {r.companyName ?? "（无公司名）"} · {r.title ?? "（无岗位名）"}
                          </span>
                          {fit && (
                            <Badge
                              variant={
                                fit.fitScore >= 75
                                  ? "default"
                                  : fit.fitScore >= 50
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              匹配 {Math.round(fit.fitScore)}
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            r.track,
                            r.department,
                            r.location,
                            r.salaryMin || r.salaryMax
                              ? `${r.salaryMin ?? "?"}-${r.salaryMax ?? "?"}K`
                              : null,
                            r.deadline ? `截止 ${r.deadline}` : null,
                            r.source,
                            r.note,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "（无其他信息）"}
                        </p>
                        {fit && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{fit.reason}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
            </div>
          </div>
        )}

        {rows && (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={reset} disabled={importing}>
              重新选文件
            </Button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={importing || checked.size === 0}
            >
              {importing ? "导入中..." : `加入信息库（${checked.size}）`}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
