"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <AlertTriangle className="size-8 text-muted-foreground/50" />
      <div className="space-y-1">
        <p className="font-medium">这个页面加载失败了</p>
        <p className="text-sm text-muted-foreground">
          可以重试一次，或者从左边换个页面看看
        </p>
      </div>
      <Button onClick={reset} size="sm">
        重试
      </Button>
    </div>
  );
}
