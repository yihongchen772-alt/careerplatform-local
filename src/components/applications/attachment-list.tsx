"use client";

import { toast } from "sonner";
import { FileIcon, XIcon } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { deleteAttachment } from "@/lib/actions/attachments";

export type AttachmentRow = {
  id: string;
  url: string;
  name: string;
};

export function AttachmentList({ attachments }: { attachments: AttachmentRow[] }) {
  if (attachments.length === 0) return null;

  async function handleDelete(id: string) {
    try {
      await deleteAttachment(id);
    } catch {
      toast.error("删除失败");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
        >
          <FileIcon className="size-3 text-muted-foreground" />
          <a
            href={a.url}
            target="_blank"
            rel="noreferrer"
            className="max-w-40 truncate underline underline-offset-2"
          >
            {a.name}
          </a>
          <ConfirmDeleteButton
            trigger={
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                aria-label="删除附件"
              >
                <XIcon className="size-3" />
              </button>
            }
            title={`确定删除附件「${a.name}」吗？`}
            onConfirm={() => handleDelete(a.id)}
          />
        </span>
      ))}
    </div>
  );
}
