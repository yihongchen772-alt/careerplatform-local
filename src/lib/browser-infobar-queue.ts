export type BrowserBannerId =
  | "pageProblem"
  | "autofillBusy"
  | "capturing"
  | "autofillPaused"
  | "submitted"
  | "otpPrompt"
  | "loginOffer"
  | "eligibilityWarning"
  | "tailoredResume"
  | "setupRecommendation"
  | "autofillDone"
  | "detectedForm"
  | "recordedBar";

export const BROWSER_INFOBAR_PRIORITY: Record<BrowserBannerId, number> = {
  pageProblem: 100,
  autofillBusy: 96,
  capturing: 94,
  autofillPaused: 92,
  submitted: 90,
  otpPrompt: 88,
  loginOffer: 84,
  eligibilityWarning: 75,
  tailoredResume: 66,
  setupRecommendation: 64,
  autofillDone: 56,
  detectedForm: 48,
  recordedBar: 44,
};

/**
 * Picks the single highest-priority active banner so multiple simultaneous
 * notices never stack vertically and crush the guest web page.
 */
export function selectPrimaryInfobar(activeIds: BrowserBannerId[]): {
  activeId: BrowserBannerId | null;
  queuedIds: BrowserBannerId[];
  queuedCount: number;
} {
  if (!activeIds.length) return { activeId: null, queuedIds: [], queuedCount: 0 };
  const unique = [...new Set(activeIds)].sort(
    (a, b) => (BROWSER_INFOBAR_PRIORITY[b] ?? 0) - (BROWSER_INFOBAR_PRIORITY[a] ?? 0)
  );
  return {
    activeId: unique[0] ?? null,
    queuedIds: unique.slice(1),
    queuedCount: Math.max(0, unique.length - 1),
  };
}
