export type DesktopUpdateState = {
  revision: number;
  currentVersion: string;
  availableVersion: string | null;
  platform: string;
  arch: string;
  mode: "in-app" | "check-only" | "manual" | "development";
  status: "idle" | "unsupported" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "installing" | "error";
  progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
  errorStage: "check" | "download" | "install" | null;
  message: string;
};

export type DesktopUpdates = {
  getState(): Promise<DesktopUpdateState>;
  check(): Promise<DesktopUpdateState>;
  download(): Promise<DesktopUpdateState>;
  install(): Promise<DesktopUpdateState>;
  openReleases(): Promise<DesktopUpdateState>;
  onState(callback: (state: DesktopUpdateState) => void): () => void;
};

declare global {
  interface Window {
    desktopUpdates?: DesktopUpdates;
  }
}
