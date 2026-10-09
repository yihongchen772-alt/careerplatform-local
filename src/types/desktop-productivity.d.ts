export {};
declare global {
  type DesktopWindowLayer = "normal" | "desktop" | "top";
  interface Window {
    desktopProductivity?: {
      open: (kind: "notes" | "calendar" | "capture", id?: string, newWindow?: boolean) => Promise<void>;
      openPosition: (id: string) => Promise<void>;
      pin: (value: boolean) => Promise<boolean>;
      /** normal: covered by windows opened later; desktop (macOS): below every window; top: above every window. */
      setLayer: (layer: DesktopWindowLayer) => Promise<DesktopWindowLayer>;
      state: () => Promise<{ pinned: boolean; layer: DesktopWindowLayer; clipboard: string; notesAtLogin: boolean; platform: string }>;
      selectNote: (id: string) => Promise<void>;
      setColor: (color: string) => Promise<void>;
      openMain: () => Promise<void>;
      setNotesAtLogin: (value: boolean) => Promise<boolean>;
    };
  }
}
