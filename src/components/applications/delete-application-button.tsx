"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { deleteApplication } from "@/lib/actions/applications";

/** Deleting from the 投递's own page, which used to be possible only from the list. */
export function DeleteApplicationButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <ConfirmDeleteButton
      trigger={<Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive">删除这条投递</Button>}
      title={`确定删除 ${label} 吗？`}
      description="这条投递的进展记录和附件也会一并删除，无法撤销。"
      onConfirm={async () => {
        try {
          await deleteApplication(id);
          toast.success("已删除");
          router.push("/applications");
        } catch {
          toast.error("删除失败");
        }
      }}
    />
  );
}
