export type DesktopProfileColor = "blue" | "rose" | "amber" | "emerald" | "violet" | "cyan";

export type DesktopProfileItem = {
  id: string;
  name: string;
  color: DesktopProfileColor;
  createdAt: string;
  isDefault: boolean;
  displayName: string;
  userRealName: string | null;
  applicationCount: number;
  resumeCount: number;
  aiKeyCount: number;
  initialized: boolean;
  browserPartition: string;
};

export type DesktopProfilesState = {
  activeProfileId: string;
  switching: boolean;
  profiles: DesktopProfileItem[];
};

export type DesktopProfilesResult =
  | ({ ok: true } & DesktopProfilesState & { syncedAiKeys?: number; message?: string })
  | { ok: false; message: string };

export type DesktopProfilesBridge = {
  list: () => Promise<DesktopProfilesState>;
  create: (payload: { name: string; color?: DesktopProfileColor; switchImmediately?: boolean }) => Promise<DesktopProfilesResult>;
  switch: (profileId: string) => Promise<DesktopProfilesResult>;
  rename: (profileId: string, name: string) => Promise<DesktopProfilesResult>;
  delete: (profileId: string) => Promise<DesktopProfilesResult>;
  syncAiKeys: (profileId?: string) => Promise<{ ok: boolean; synced: number; skipped: number; providers?: string[]; message?: string }>;
  onSwitching: (callback: (payload: { switching: boolean; targetId?: string; targetName?: string; error?: string }) => void) => () => void;
  onChanged: (callback: (state: DesktopProfilesState) => void) => () => void;
  onOpenCreateDialog: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    desktopProfiles?: DesktopProfilesBridge;
  }
}
