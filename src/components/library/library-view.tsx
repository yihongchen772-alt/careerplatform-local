"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Upload, FileText, Paperclip } from "lucide-react";
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
import { addAttachment, deleteAttachment } from "@/lib/actions/attachments";

/**
 * Fixed shelves rather than free-form tags: the point of this page is that
 * everything lands somewhere findable, and free tags reliably decay into
 * five spellings of the same thing. "其他" absorbs whatever doesn't fit.
 */
export const LIBRARY_CATEGORIES = [
  "证书",
  "作品集",
  "笔试资料",
  "面试资料",
  "其他",
] as const;

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
  const fileInput = useRef<HTMLInputElement>(null);

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

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
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
            PDF、图片、Word/PPT/Excel、zip、txt，单个 25MB 以内。文件存在本机，不上传云端。
          </p>
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
  return (
    <div className="flex items-start gap-2 rounded-lg border p-3">
      {file.category ? (
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
          {new Date(file.createdAt).toLocaleDateString()}
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
