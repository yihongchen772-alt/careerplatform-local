"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Wraps the main content column and switches `/browser` into an edge-to-edge
 * workspace without wasting bottom or side padding.
 */
export function DashboardMain({ className, children }: { className: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isBrowser = pathname === "/browser" || pathname.startsWith("/browser/");
  return (
    <main
      className={cn(
        className,
        isBrowser && "px-2 pb-2 pt-[calc(3.5rem+env(safe-area-inset-top)+0.25rem)] md:px-4 md:pb-3 md:pt-3"
      )}
    >
      {children}
    </main>
  );
}
