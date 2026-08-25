/**
 * Plain module, deliberately not "use server": a "use server" file may only
 * export async functions, so the type and the default object can't live in
 * the action file alongside them.
 *
 * These are the settings Electron's main process needs to act on (tray
 * behaviour, launch-at-login, the background reminder timer). They're kept
 * in a JSON file next to the database rather than in the database itself
 * because the main process has no Prisma client — only the filesystem.
 */
export type AppSettings = {
  /** Start the app automatically when the computer starts. */
  autoLaunch: boolean;
  /** Keep running in the tray after the window is closed, so reminders can fire. */
  backgroundReminders: boolean;
  /**
   * How often, in hours, the background process re-scans the inbox. 0 means
   * "only when the app starts" — the original behaviour. Only has any effect
   * with backgroundReminders on, since nothing is running otherwise.
   */
  inboxScanIntervalHours?: number;
  /**
   * Written by the Electron main process when the OS refused to register the
   * login item (sandboxing, MDM policy, unsigned build). Read-only from the
   * app's side — it exists so a silently-ignored setting shows up as a
   * warning instead of a checkbox that looks on but does nothing.
   */
  autoLaunchFailed?: boolean;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoLaunch: false,
  backgroundReminders: false,
  inboxScanIntervalHours: 0,
};

/** Options offered in settings; 0 keeps the launch-only behaviour. */
export const SCAN_INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "只在打开 App 时扫一次" },
  { value: 1, label: "每 1 小时" },
  { value: 2, label: "每 2 小时" },
  { value: 4, label: "每 4 小时" },
  { value: 6, label: "每 6 小时" },
  { value: 12, label: "每 12 小时" },
];
