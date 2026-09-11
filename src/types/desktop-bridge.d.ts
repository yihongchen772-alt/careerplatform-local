export type DesktopBridgeNavState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  zoomFactor: number;
};

export type DesktopBridgeAutofillStatus = {
  phase: "scanning" | "ai" | "done" | "error";
  message: string;
};

export type DesktopBridgeCapturedPage = { url: string; title: string; text: string };

export type DesktopBridgeRect = { x: number; y: number; width: number; height: number };

export type DesktopBridge = {
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  setBounds(rect: DesktopBridgeRect | null): Promise<void>;
  autofill(resumeVersionId?: string): Promise<void>;
  saveCorrections(): Promise<{ saved: number }>;
  capturePage(): Promise<DesktopBridgeCapturedPage>;
  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  zoomReset(): Promise<void>;
  onNavState(callback: (state: DesktopBridgeNavState) => void): () => void;
  onAutofillStatus(callback: (status: DesktopBridgeAutofillStatus) => void): () => void;
};

export type WhisperModelName = "small" | "medium";

export type WhisperStatus = {
  binaryAvailable: boolean;
  models: Record<WhisperModelName, { file: string; bytes: number; label: string; installed: boolean }>;
  activeModel: WhisperModelName | null;
  downloading: { name: WhisperModelName; received: number; total: number } | null;
};

export type DesktopWhisper = {
  getStatus(): Promise<WhisperStatus>;
  downloadModel(name: WhisperModelName): Promise<void>;
  cancelDownload(): Promise<void>;
  deleteModel(name: WhisperModelName): Promise<void>;
  onStatus(callback: (status: WhisperStatus) => void): () => void;
};

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
    desktopWhisper?: DesktopWhisper;
  }
}

export {};
