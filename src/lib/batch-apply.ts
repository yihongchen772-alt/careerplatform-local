"use client";

import type { DesktopBridgeBatchJob } from "@/types/desktop-bridge";

export const BATCH_APPLY_STORAGE_KEY = "careerplatform.browser.pendingBatch";

/**
 * Opens multiple target job URLs in the Desktop 网申浏览器 and queues
 * background prefill cleanly; degrades gracefully to sessionStorage links in web mode.
 */
export async function launchBatchApply(
  jobs: DesktopBridgeBatchJob[],
  navigate: (href: string) => void
): Promise<{ mode: "desktop" | "web"; count: number }> {
  const valid = jobs.filter((j) => typeof j.url === "string" && /^https?:\/\//i.test(j.url.trim())).slice(0, 20);
  if (!valid.length) return { mode: "web", count: 0 };

  if (typeof window !== "undefined" && window.desktopBridge?.openBatch) {
    await window.desktopBridge.openBatch(valid, { autoFill: true });
    navigate("/browser");
    return { mode: "desktop", count: valid.length };
  }

  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(BATCH_APPLY_STORAGE_KEY, JSON.stringify(valid));
    } catch {
      // ignore storage quota errors
    }
  }
  navigate(`/browser?url=${encodeURIComponent(valid[0].url)}`);
  return { mode: "web", count: valid.length };
}
