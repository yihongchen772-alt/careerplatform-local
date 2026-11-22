export {};
declare global {
  type DesktopWindowLayer = "normal" | "desktop" | "top";
  interface Window {
    desktopProductivity?: {
      open: (kind: "notes" | "calendar" | "capture", id?: string, newWindow?: boolean) => Promise<void>;
      openPosition: (id: string) => Promise<void>;
      /** Shows the main window on this 投递's page. Missing in builds before v1.13. */
      openApplication?: (id: string) => Promise<void>;
      /** An http(s) link in the system browser. */
      openExternal?: (url: string) => Promise<void>;
      pin: (value: boolean) => Promise<boolean>;
      /** normal: covered by windows opened later; desktop (macOS): below every window; top: above every window. */
      setLayer: (layer: DesktopWindowLayer) => Promise<DesktopWindowLayer>;
      state: () => Promise<{ pinned: boolean; layer: DesktopWindowLayer; clipboard: string; notesAtLogin: boolean; platform: string }>;
      selectNote: (id: string) => Promise<void>;
      setColor: (color: string) => Promise<void>;
      openMain: () => Promise<void>;
      setNotesAtLogin: (value: boolean) => Promise<boolean>;
    };
    desktopLanSync?: {
      status: () => Promise<{ ok: true; data: DesktopLanSyncStatus } | { ok: false; message: string }>;
      startShare: () => Promise<{ ok: true; data: DesktopLanSyncStatus } | { ok: false; message: string }>;
      stopShare: () => Promise<{ ok: true; data: DesktopLanSyncStatus } | { ok: false; message: string }>;
      pull: (args: { address: string; code?: string }) => Promise<
        | {
            ok: true;
            stagingId: string;
            sender: { hostname: string; platform: string; sizeMb: string };
            preview: { exportedAt: string; counts: { label: string; n: number }[]; files: number };
          }
        | { ok: false; message: string }
      >;
      confirmImport: (stagingId: string) => Promise<
        | { ok: true; data: { restored: number; skipped: number; filesMigrated: number; filesFailed: number } }
        | { ok: false; message: string }
      >;
      discardStaged: (stagingId?: string) => Promise<{ ok: boolean }>;
    };
  }

  type DesktopLanSyncStatus =
    | { active: false }
    | {
        active: true;
        code: string;
        port: number;
        addresses: { name: string; address: string; endpoint: string }[];
        primaryAddress: string;
        pairingToken: string;
        expiresAt: string;
        files: number;
        sizeMb: string;
        transferCount: number;
        hostname: string;
        platform: string;
      };
}
