"use client";

import { Copy, ExternalLink, Video } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { extractMeetingNumber, extractMeetingUrl } from "@/lib/interview-schedule";

/**
 * 「进入会议」 opens the link in the system browser (the App sends any new
 * window there), and 复制 copies the meeting number or the whole text for
 * an address — whichever the invitation gave.
 */
export function MeetingActions({ info, size = "sm", className, compact = false, exam = false }: { info: string | null | undefined; size?: "sm" | "xs"; className?: string; compact?: boolean; /** A 笔试 / 测评 link: 「打开测评」 rather than 「进入会议」. */ exam?: boolean }) {
  if (!info?.trim()) return null;
  const url = extractMeetingUrl(info);
  const number = extractMeetingNumber(info);
  const copyText = number ?? info.trim();
  const height = size === "xs" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" title={url} className={cn(buttonVariants({ size: "sm" }), "gap-1 rounded-full", height)}>
          {exam ? <ExternalLink className="size-3.5" /> : <Video className="size-3.5" />}
          {exam ? "打开测评" : "进入会议"}
        </a>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn("gap-1 rounded-full", height)}
        title={copyText}
        onClick={() => {
          void navigator.clipboard.writeText(copyText).then(
            () => toast.success(number ? `已复制会议号 ${number}` : "已复制会议信息"),
            () => toast.error("复制失败，请手动选中复制")
          );
        }}
      >
        <Copy className="size-3.5" />
        {compact ? (number ? "会议号" : "复制") : number ? `复制会议号` : url ? "复制链接" : "复制地点"}
      </Button>
    </span>
  );
}
