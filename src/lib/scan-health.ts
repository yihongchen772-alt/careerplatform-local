import { db } from "@/lib/db";

/** Failures in a row before it is worth interrupting: one is often a blip. */
export const SCAN_ALERT_STREAK = 2;

export type ScanHealth = { failing: boolean; error: string | null; since: Date | null; lastOkAt: Date | null };

/** For the 「自动读邮件停了」 banner and the settings card. */
export async function getScanHealth(userId: string): Promise<ScanHealth> {
  const [user, accounts] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { inboxScanFailStreak: true, inboxScanError: true, inboxScanErrorAt: true, inboxScanOkAt: true } }),
    db.mailAccount.count({ where: { userId, enabled: true } }),
  ]);
  if (!user) return { failing: false, error: null, since: null, lastOkAt: null };
  return {
    failing: accounts > 0 && user.inboxScanFailStreak >= SCAN_ALERT_STREAK,
    error: user.inboxScanError,
    since: user.inboxScanErrorAt,
    lastOkAt: user.inboxScanOkAt,
  };
}
