export type DesktopBridgeTab = {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
};

export type DesktopBridgeTabsState = { tabs: DesktopBridgeTab[]; activeId: number | null };

/** Where an autofilled value came from — matches the outline colour on the page. */
export type DesktopBridgeFillSource = "profile" | "memory" | "ai" | "manual" | "prefilled";

export type DesktopBridgeAutofillOptions = {
  /** Press the page's 添加 button when the profile has more 教育/实习/项目 rows than blocks shown. */
  expandBlocks?: boolean;
  /** 网申资料方案 id; omitted = the default profile. */
  variantId?: string;
};

export type DesktopBridgeAutofillStatus = {
  phase: "scanning" | "ai" | "done" | "error";
  message: string;
  details?: { label: string; state: string; source?: DesktopBridgeFillSource }[];
};

export type DesktopBridgeCapturedPage = { url: string; title: string; text: string };

export type DesktopBridgeHistoryEntry = { url: string; title: string; at: number };

export type DesktopBridgeShortcut = {
  action: "new-tab" | "close-tab" | "focus-address" | "find";
  tabId: number;
};

export type DesktopBridgeDownload = { state: "completed" | "cancelled" | "interrupted"; filename: string; path: string };

export type DesktopBridgeRect = { x: number; y: number; width: number; height: number };

export type DesktopBridge = {
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  setBounds(rect: DesktopBridgeRect | null): Promise<void>;
  autofill(resumeVersionId?: string, options?: DesktopBridgeAutofillOptions): Promise<void>;
  saveCorrections(resumeVersionId?: string, onlyUserEdited?: boolean): Promise<{ saved: number }>;
  clearMarks(): Promise<void>;
  capturePage(): Promise<DesktopBridgeCapturedPage>;
  exportFormStructure(): Promise<{ path: string; fields: number; frames: number }>;
  chooseDirectory(): Promise<string | null>;
  exportDocument(payload: { format: "pdf" | "doc"; html: string; fileName: string }): Promise<{ path: string }>;
  openExtensionFolder(): Promise<{ path: string }>;
  screenshot(): Promise<{ dataUrl: string; url: string; title: string }>;
  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  zoomReset(): Promise<void>;
  newTab(url?: string): Promise<number>;
  switchTab(id: number): Promise<void>;
  closeTab(id: number): Promise<void>;
  getTabs(): Promise<DesktopBridgeTabsState>;
  openExternal(): Promise<void>;
  copyUrl(): Promise<void>;
  history(): Promise<DesktopBridgeHistoryEntry[]>;
  clearHistory(): Promise<void>;
  showDownload(file: string): Promise<void>;
  clearSiteData(): Promise<void>;
  dismissForm(payload: { tabId: number; signature: string }): Promise<void>;
  onFormDetected(callback: (payload: { tabId: number; count: number; signature: string }) => void): () => void;
  onApplicationSubmitted(callback: (payload: { tabId: number; url: string; title: string; evidence: string }) => void): () => void;
  find(options: { text: string; forward?: boolean; findNext?: boolean }): Promise<void>;
  findStop(): Promise<void>;
  onTabs(callback: (state: DesktopBridgeTabsState) => void): () => void;
  onAutofillStatus(callback: (status: DesktopBridgeAutofillStatus) => void): () => void;
  onShortcut(callback: (payload: DesktopBridgeShortcut) => void): () => void;
  onDownload(callback: (payload: DesktopBridgeDownload) => void): () => void;
  onFindResult(callback: (payload: { tabId: number; active: number; total: number }) => void): () => void;
};

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

export {};
