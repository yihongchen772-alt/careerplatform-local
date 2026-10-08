"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: "bg-primary/[0.06] [&>svg:first-child]:text-primary",
  success: "bg-emerald-500/[0.08] [&>svg:first-child]:text-emerald-600",
  warning: "bg-amber-500/[0.09] [&>svg:first-child]:text-amber-600",
  danger: "bg-destructive/[0.08] [&>svg:first-child]:text-destructive",
  neutral: "bg-card [&>svg:first-child]:text-muted-foreground",
} as const;

/**
 * A browser infobar: one slim row between the toolbar and the page, the way
 * Chrome shows "translate this page?" — a message, its actions on the
 * right, and a close button. Everything the 网申浏览器 has to say about the
 * current page (a form was found, 投递成功, 已投过这家, fill progress) uses it.
 */
export function Infobar({
  tone = "info",
  icon,
  children,
  actions,
  onClose,
  closeLabel = "关闭提示",
  className,
}: {
  tone?: keyof typeof TONES;
  icon?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
}) {
  return (
    <div role="status" className={cn("flex min-h-9 shrink-0 items-center gap-2.5 border-b px-3 py-1 text-[12.5px] [&>svg:first-child]:size-4 [&>svg:first-child]:shrink-0", TONES[tone], className)}>
      {icon}
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      {onClose && (
        <button type="button" aria-label={closeLabel} title={closeLabel} onClick={onClose} className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
