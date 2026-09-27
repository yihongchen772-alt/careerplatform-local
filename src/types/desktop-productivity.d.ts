export {};
declare global {
  interface Window {
    desktopProductivity?: {
      open: (kind: "notes" | "calendar" | "capture", id?: string, newWindow?: boolean) => Promise<void>;
      openPosition: (id: string) => Promise<void>;
      pin: (value: boolean) => Promise<boolean>;
      state: () => Promise<{ pinned: boolean; clipboard: string }>;
      selectNote: (id: string) => Promise<void>;
    };
  }
}
