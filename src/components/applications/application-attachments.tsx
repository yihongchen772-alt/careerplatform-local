"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileUploadButton } from "@/components/ui/file-upload-button";
import { AttachmentList, type AttachmentRow } from "@/components/applications/attachment-list";
import { addAttachment } from "@/lib/actions/attachments";

export function ApplicationAttachments({
  applicationId,
  initialAttachments,
}: {
  applicationId: string;
  initialAttachments: AttachmentRow[];
}) {
  const [attachments, setAttachments] = useState(initialAttachments);

  async function handleUploaded(file: { url: string; name: string }) {
    try {
      const created = await addAttachment({ applicationId, ...file });
      setAttachments((prev) => [...prev, created]);
    } catch {
      toast.error("保存附件失败");
    }
  }

  return (
    <div className="space-y-2">
      <FileUploadButton label="上传 offer letter / 其他文件" onUploaded={handleUploaded} />
      <AttachmentList attachments={attachments} />
    </div>
  );
}
