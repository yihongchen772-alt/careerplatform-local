"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Upload, FileText, Paperclip, Sparkles, Camera, CheckCircle2, Star, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addAttachment,
  deleteAttachment,
  extractResumePhotoToLibrary,
  pinLibraryAttachment,
  updateLibraryAttachment,
} from "@/lib/actions/attachments";
import {
  ATTACHMENT_ROLE_META,
  AUTOFILL_LIBRARY_CATEGORIES,
  LIBRARY_CATEGORIES,
  type AttachmentRole,
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

export type LibraryResumeOption = {
  id: string;
  name: string;
  isDefault?: boolean;
};

export function LibraryView({
  files,
  resumeVersions = [],
  initialPinned = {},
}: {
  files: LibraryFile[];
  resumeVersions?: LibraryResumeOption[];
  initialPinned?: Record<string, string>;
}) {
  const [category, setCategory] = useState<string>(LIBRARY_CATEGORIES[0]);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [pinned, setPinned] = useState<Record<string, string>>(initialPinned);
  const [photoResumeId, setPhotoResumeId] = useState<string>(
    () => resumeVersions.find((r) => r.isDefault)?.id ?? resumeVersions[0]?.id ?? ""
  );
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleExtractPhoto() {
    setExtracting(true);
    try {
      const res = await extractResumePhotoToLibrary(photoResumeId || undefined);
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

  async function handleUpload(selected: File[]) {
    if (selected.length === 0) return;
    setUploading(true);
    let okCount = 0;
    const errors: string[] = [];
    try {
      for (const file of selected) {
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/upload/library", { method: "POST", body: form });
          const json = await res.json();
          if (!res.ok) {
            errors.push(`${file.name}: ${json.error ?? "上传失败"}`);
            continue;
          }
          await addAttachment({ category, url: json.url, name: json.name });
          okCount += 1;
        } catch {
          errors.push(`${file.name}: 上传失败`);
        }
      }
      if (okCount > 0) {
        toast.success(okCount === 1 ? `已存进「${category}」` : `已批量上传 ${okCount} 个文件到「${category}」`);
      }
      if (errors.length > 0) {
        toast.error(errors[0] + (errors.length > 1 ? ` 等 ${errors.length} 项失败` : ""));
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handlePin(role: AttachmentRole, fileId: string, isPinned: boolean) {
    try {
      const res = await pinLibraryAttachment(role, isPinned ? null : fileId);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setPinned(res.pinned);
      toast.success(isPinned ? "已取消默认固定，恢复自动取最新一份" : "已设为网申自动附带默认文件");
    } catch {
      toast.error("更新默认附件失败");
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
            {resumeVersions.length > 1 && (
              <Select value={photoResumeId} onValueChange={(v) => v && setPhotoResumeId(v)}>
                <SelectTrigger className="w-44" title="选择要从哪份 PDF 简历提取证件照">
                  <SelectValue>
                    {() => resumeVersions.find((r) => r.id === photoResumeId)?.name ?? "选择简历"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {resumeVersions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      {r.isDefault ? "（默认）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={extracting}
              onClick={() => void handleExtractPhoto()}
              title="从选定 PDF 简历里自动抠出证件照并存进「证件照」"
            >
              <Camera className="mr-1.5 size-4" />
              {extracting ? "提取中..." : "从简历提取证件照"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length > 0) void handleUpload(list);
              }}
            />
            <p className="text-xs text-muted-foreground">
              支持多选上传：PDF、图片、Word/PPT/Excel、zip、txt、md，单个 25MB 以内。文件只保存在本机。
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
            <span className="text-muted-foreground">（网页「一键填写」遇到对应上传框会自动选上；点卡片星标可固定默认使用哪一份）</span>
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
                {g.items.map((f) => {
                  const role = inferAttachmentRole(f.category, f.name);
                  const isPinned = role ? pinned[role] === f.id : false;
                  return (
                    <FileCard
                      key={f.id}
                      file={f}
                      role={role}
                      isPinned={isPinned}
                      onPin={handlePin}
                    />
                  );
                })}
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
                  <FileCard key={f.id} file={f} role={null} isPinned={false} onPin={handlePin} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function FileCard({
  file,
  role,
  isPinned,
  onPin,
}: {
  file: LibraryFile;
  role: AttachmentRole | null;
  isPinned: boolean;
  onPin: (role: AttachmentRole, fileId: string, isPinned: boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(file.name);
  const [draftCategory, setDraftCategory] = useState(file.category ?? LIBRARY_CATEGORIES[0]);
  const [saving, setSaving] = useState(false);

  const isImage =
    file.category === "证件照" ||
    /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name) ||
    /\.(jpg|jpeg|png|webp|gif)$/i.test(file.url);

  async function saveEdit() {
    setSaving(true);
    try {
      const res = await updateLibraryAttachment(file.id, { name: draftName, category: draftCategory });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("资料已更新");
      setEditing(false);
    } catch {
      toast.error("更新失败，请重试");
    } finally {
      setSaving(false);
    }
  }

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
        {editing ? (
          <div className="space-y-1.5">
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="h-7 text-xs"
              placeholder="文件名称"
            />
            <div className="flex items-center gap-1">
              <Select value={draftCategory} onValueChange={(v) => v && setDraftCategory(v)}>
                <SelectTrigger className="h-7 flex-1 text-xs">
                  <SelectValue>{() => draftCategory}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LIBRARY_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="icon-xs" disabled={saving} onClick={() => void saveEdit()} title="保存">
                <Check className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  setDraftName(file.name);
                  setDraftCategory(file.category ?? LIBRARY_CATEGORIES[0]);
                  setEditing(false);
                }}
                title="取消"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                title={file.name}
              >
                {file.name}
              </a>
              {isPinned && (
                <Badge variant="secondary" className="shrink-0 bg-amber-500/15 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-300">
                  自动附带·默认
                </Badge>
              )}
            </div>
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
          </>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5">
          {role && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title={isPinned ? "取消固定为网申默认" : `固定为「${ATTACHMENT_ROLE_META[role].category}」网申默认附件`}
              onClick={() => void onPin(role, file.id, isPinned)}
              className={isPinned ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground"}
            >
              <Star className={`size-3.5 ${isPinned ? "fill-current" : ""}`} />
            </Button>
          )}
          {file.category && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title="重命名或改分类"
              onClick={() => setEditing(true)}
              className="text-muted-foreground"
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
          <ConfirmDeleteButton
            trigger={
              <Button type="button" variant="ghost" size="sm" className="shrink-0 px-2">
                删除
              </Button>
            }
            title={`删除「${file.name}」？`}
            onConfirm={async () => {
              try {
                await deleteAttachment(file.id);
                toast.success("已删除");
              } catch {
                toast.error("删除失败，请重试");
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
