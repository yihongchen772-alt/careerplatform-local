"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Upload, FileText, Paperclip, Sparkles, Camera, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addAttachment, deleteAttachment, extractResumePhotoToLibrary } from "@/lib/actions/attachments";
import {
  ATTACHMENT_ROLE_META,
  AUTOFILL_LIBRARY_CATEGORIES,
  LIBRARY_CATEGORIES,
  inferAttachmentRole,
} from "@/lib/attachment-roles";

export { LIBRARY_CATEGORIES };

export type LibraryFile = {
  id: string;
  name: string;
  url: string;
  category: string | null;
  createdAt: string;
  application: { id: string; companyName: string; title: string } | null;
};

export function LibraryView({ files }: { files: LibraryFile[] }) {
  const [category, setCategory] = useState<string>(LIBRARY_CATEGORIES[0]);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleExtractPhoto() {
    setExtracting(true);
    try {
      const res = await extractResumePhotoToLibrary();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`已提取证件照「${res.name}」，网申时会自动识别照片栏并上传`);
    } catch {
      toast.error("提取证件照失败，请直接上传证件照图片");
    } finally {
      setExtracting(false);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload/library", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "上传失败");
        return;
      }
      await addAttachment({ category, url: json.url, name: json.name });
      toast.success(`已存进「${category}」`);
    } catch {
      toast.error("上传失败，请重试");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  // Files attached to an application carry no category — they're grouped
  // under a shelf of their own rather than being forced into one, since the
  // application already gives them their context.
  const grouped = LIBRARY_CATEGORIES.map((c) => ({
    category: c,
    items: files.filter((f) => f.category === c),
  })).filter((g) => g.items.length > 0);

  const fromApplications = files.filter((f) => !f.category);
  const readyRoles = new Set(
    files
      .filter((f) => !!f.category)
      .map((f) => inferAttachmentRole(f.category, f.name))
      .filter((role): role is NonNullable<typeof role> => role !== null)
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">存到哪一类</p>
              <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                <SelectTrigger className="w-40">
                  <SelectValue>{() => category}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LIBRARY_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="mr-1.5 size-4" />
              {uploading ? "上传中..." : "上传文件"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={extracting}
              onClick={() => void handleExtractPhoto()}
              title="从默认 PDF 简历里自动抠出证件照并存进「证件照」"
            >
              <Camera className="mr-1.5 size-4" />
              {extracting ? "提取中..." : "从简历提取证件照"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <p className="text-xs text-muted-foreground">
              PDF、图片、Word/PPT/Excel、zip、txt，单个 25MB 以内。文件只保存在本机。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/45 px-3 py-2 text-xs">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Sparkles className="size-3.5 text-primary" />
              网申自动附带清单：
            </span>
            {Object.entries(ATTACHMENT_ROLE_META).map(([role, meta]) => {
              const ready = readyRoles.has(role as keyof typeof ATTACHMENT_ROLE_META);
              return (
                <button
                  key={role}
                  type="button"
                  title={`${meta.hint}（点一下切换到「${meta.category}」上传）`}
                  onClick={() => setCategory(meta.category)}
                  className={
                    ready
                      ? "inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
                      : "inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  }
                >
                  {ready && <CheckCircle2 className="size-3" />}
                  {meta.category}
                </button>
              );
            })}
            <span className="text-muted-foreground">（网页「一键填写」遇到对应上传框会自动选上并规范命名）</span>
          </div>
        </CardContent>
      </Card>

      {files.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          还没有资料。证书、作品集、笔试真题、面试资料都可以传上来，集中放一处。
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((g) => (
            <section key={g.category} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">{g.category}</h2>
                <Badge variant="secondary">{g.items.length}</Badge>
                {AUTOFILL_LIBRARY_CATEGORIES.has(g.category) && (
                  <Badge variant="outline" className="text-[11px] font-normal text-emerald-700 dark:text-emerald-400">
                    网申自动附带
                  </Badge>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((f) => (
                  <FileCard key={f.id} file={f} />
                ))}
              </div>
            </section>
          ))}

          {fromApplications.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium">投递记录里的附件</h2>
                <Badge variant="secondary">{fromApplications.length}</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {fromApplications.map((f) => (
                  <FileCard key={f.id} file={f} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function FileCard({ file }: { file: LibraryFile }) {
  const isImage =
    file.category === "证件照" ||
    /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name) ||
    /\.(jpg|jpeg|png|webp|gif)$/i.test(file.url);
  return (
    <div className="flex items-start gap-2.5 rounded-lg border p-3">
      {isImage ? (
        // Local served proof photo thumbnail
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.url} alt={file.name} className="size-10 shrink-0 rounded-md border object-cover" />
      ) : file.category ? (
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      ) : (
        <Paperclip className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm font-medium underline-offset-4 hover:underline"
          title={file.name}
        >
          {file.name}
        </a>
        {file.application && (
          <Link
            href={`/applications/${file.application.id}`}
            className="mt-0.5 block truncate text-xs text-muted-foreground hover:underline"
          >
            {file.application.companyName} · {file.application.title}
          </Link>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {new Date(file.createdAt).toLocaleDateString("zh-CN")}
        </p>
      </div>
      <ConfirmDeleteButton
        trigger={
          <Button type="button" variant="ghost" size="sm" className="shrink-0">
            删除
          </Button>
        }
        title={`删除「${file.name}」？`}
        onConfirm={async () => {
          await deleteAttachment(file.id);
          toast.success("已删除");
        }}
      />
    </div>
  );
}
