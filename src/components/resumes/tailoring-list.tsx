"use client";

import Link from "next/link";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDeleteButton } from "@/components/ui/confirm-delete-button";
import { deleteTailoring } from "@/lib/actions/resume-tailor";

export type TailoringRow = {
  id: string;
  target: string;
  baseName: string;
  savedName: string | null;
  generated: boolean;
  updatedAt: string;
};

/** 定制记录 on the 简历版本 page: every 按 JD 定制 working copy, newest first. */
export function TailoringList({ rows }: { rows: TailoringRow[] }) {
  if (!rows.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-medium"><Wand2 className="size-4 text-primary" />定制记录</h2>
      <div className="divide-y rounded-xl border">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{row.target}</span>
            <span className="text-xs text-muted-foreground">基于「{row.baseName}」</span>
            <span className="text-xs text-muted-foreground">
              {row.savedName ? `已存为「${row.savedName}」` : row.generated ? "还没存成简历版本" : "还没生成"} · {row.updatedAt}
            </span>
            <Link href={`/resumes/tailor?id=${encodeURIComponent(row.id)}`} className={buttonVariants({ size: "xs", variant: "outline" })}>
              {row.generated ? "继续改" : "去生成"}
            </Link>
            <ConfirmDeleteButton
              trigger={<Button size="xs" variant="ghost">删除</Button>}
              title={`删除「${row.target}」这份定制？${row.savedName ? `已存成的简历版本「${row.savedName}」会保留。` : ""}`}
              onConfirm={async () => {
                const result = await deleteTailoring(row.id);
                if (!result.ok) toast.error(result.message);
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
