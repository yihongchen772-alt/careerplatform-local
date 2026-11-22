"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { askXiaoOu } from "@/components/dashboard/agent-brief-card";
import type { AgentMode } from "@/lib/agent/modes";
import { cn } from "@/lib/utils";

/**
 * Reusable one-click trigger that opens 小欧 directly into a target expert mode
 * (CareerOps / Mock Interview / Resume Tailor / Offer Coach) with a pre-filled prompt.
 */
export function AskXiaoOuButton({
  label,
  prompt,
  mode = "general",
  send = true,
  variant = "outline",
  size = "sm",
  className,
}: {
  label: string;
  prompt: string;
  mode?: AgentMode;
  send?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "xs" | "sm" | "default";
  className?: string;
}) {
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={cn("gap-1.5", className)}
      onClick={() => askXiaoOu({ text: prompt, mode, send })}
    >
      <Sparkles className="size-3.5 text-primary" />
      {label}
    </Button>
  );
}
