"use client";

import type { DesktopBridgeBatchJob } from "@/types/desktop-bridge";

export const BATCH_APPLY_STORAGE_KEY = "careerplatform.browser.pendingBatch";

export function buildBrowserApplyHref(
  url: string,
  options?: { resumeVersionId?: string; variantId?: string; positionId?: string }
): string {
  const params = new URLSearchParams({ url });
  if (options?.positionId) params.set("positionId", options.positionId);
  if (options?.resumeVersionId) params.set("resumeVersionId", options.resumeVersionId);
  if (options?.variantId) params.set("variantId", options.variantId);
  return `/browser?${params.toString()}`;
}

/**
 * Opens multiple target job URLs in the Desktop 网申浏览器 and queues
 * background prefill cleanly; degrades gracefully to sessionStorage links in web mode.
 */
export async function launchBatchApply(
  jobs: DesktopBridgeBatchJob[],
  navigate: (href: string) => void,
  options?: { resumeVersionId?: string; variantId?: string }
): Promise<{ mode: "desktop" | "web"; count: number }> {
  const valid = jobs.filter((j) => typeof j.url === "string" && /^https?:\/\//i.test(j.url.trim())).slice(0, 20);
  if (!valid.length) return { mode: "web", count: 0 };

  const params = new URLSearchParams();
  if (options?.resumeVersionId) params.set("resumeVersionId", options.resumeVersionId);
  if (options?.variantId) params.set("variantId", options.variantId);

  if (typeof window !== "undefined" && window.desktopBridge?.openBatch) {
    await window.desktopBridge.openBatch(valid, {
      autoFill: true,
      resumeVersionId: options?.resumeVersionId || undefined,
      variantId: options?.variantId || undefined,
    });
    const qs = params.toString();
    navigate(qs ? `/browser?${qs}` : "/browser");
    return { mode: "desktop", count: valid.length };
  }

  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(BATCH_APPLY_STORAGE_KEY, JSON.stringify(valid));
    } catch {
      // ignore storage quota errors
    }
  }
  params.set("url", valid[0].url);
  navigate(`/browser?${params.toString()}`);
  return { mode: "web", count: valid.length };
}
