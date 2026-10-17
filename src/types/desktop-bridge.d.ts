export type DesktopBridgeTab = {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  /** The site's icon as a data URL, once the page reports one. */
  favicon?: string | null;
};

export type DesktopBridgeTabsState = { tabs: DesktopBridgeTab[]; activeId: number | null };

/** Where an autofilled value came from — matches the outline colour on the page. */
export type DesktopBridgeFillSource = "profile" | "memory" | "ai" | "manual" | "prefilled" | "excluded";

export type DesktopBridgeAutofillModule = "basic" | "education" | "experience" | "project" | "award" | "campus" | "questions" | "other" | "resume";

export type FillProposal = { id: string; fieldKey: string; label: string; section?: string; value: string; selected: boolean; eligible: boolean; source: string; ref: string; required?: boolean; maxLength?: number | null; note: string; edited?: boolean; remember?: boolean };
export type FillRecordBlock = { id: string; label: string; note: string; fieldIds: string[]; choices: { ref: string; label: string; values: Record<string, { value: string; ref: string }> }[] };
export type FillPlan = { id: string; url: string; proposals: FillProposal[]; choices: { ref: string; label: string; value: string }[]; blocks?: FillRecordBlock[]; uploadResume: boolean; contextKey: string; positionId?: string; resumeVersionId?: string; variantId?: string };
export type ApplicationSnapshot = {
  fields: { label: string; value: string }[]; url: string; positionId?: string; resumeVersionId?: string; variantId?: string; contextKey?: string;
  /** The current page's title, visible text (capped) and og:site_name, and this tab's earlier pages. */
  title?: string; text?: string; siteName?: string; history?: { url: string; title: string }[];
};
export type DesktopBridgeAutofillOptions = {
  mode?: "preview" | "apply";
  positionId?: string;
  regenerate?: boolean;
  questionIds?: string[];
  previewEdits?: { id: string; value: string; selected: boolean; ref?: string; remember?: boolean; edited?: boolean }[];
  answerLength?: number;
  planId?: string;
  approved?: { id: string; value: string; ref?: string; remember?: boolean; edited?: boolean }[];
  uploadResume?: boolean;
  /** Only fill these modules; omitted = all, empty = none. */
  modules?: DesktopBridgeAutofillModule[];
  /** Press the page's 添加 button when the profile has more 教育/实习/项目 rows than blocks shown. */
  expandBlocks?: boolean;
  /** 网申资料方案 id; omitted = the default profile. */
  variantId?: string;
};

export type DesktopBridgeAutofillStatus = {
  tabId?: number;
  phase: "scanning" | "ai" | "done" | "error" | "preview";
  message: string;
  plan?: FillPlan;
  summary?: { filled: number; manual: number; preserved: number; excluded: number; uploaded: number };
  details?: { id?: string; label: string; state: string; source?: DesktopBridgeFillSource }[];
};

export type DesktopBridgeCapturedPage = { url: string; title: string; text: string };

export type DesktopBridgeHistoryEntry = { url: string; title: string; at: number };

export type DesktopBridgeShortcut = {
  action: "new-tab" | "close-tab" | "focus-address" | "find";
  tabId: number;
};

export type DesktopBridgeDownload = { state: "completed" | "cancelled" | "interrupted"; filename: string; path: string };

export type DesktopBridgeRect = { x: number; y: number; width: number; height: number };

/** A kept 网申 account, without its password. */
export type SavedLoginAccount = { id: string; username: string };
export type SavedLogin = { id: string; realm: string; site: string; username: string; createdAt: number; updatedAt: number; lastUsedAt: number | null };
/** What the key icon knows about the tab's login form. */
export type LoginState = { site: string; realm: string; accounts: SavedLoginAccount[]; nearby: (SavedLoginAccount & { site: string })[]; filled: string | null };
export type LoginOffer = { tabId: number; site: string; username: string; update: boolean };

export type DesktopBridge = {
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  setBounds(rect: DesktopBridgeRect | null): Promise<void>;
  focusField(id: string): Promise<void>;
  applicationSnapshot(): Promise<ApplicationSnapshot | null>;
  autofill(resumeVersionId?: string, options?: DesktopBridgeAutofillOptions): Promise<void>;
  cancelAutofill(tabId?: number): Promise<void>;
  saveCorrections(resumeVersionId?: string, onlyUserEdited?: boolean, positionId?: string, variantId?: string, discover?: boolean): Promise<{ saved: number; pending?: number; pendingTotal?: number; draftSaved?: boolean; unchanged?: number }>;
  /** 「这页没填好」: saves the page's form structure (no filled-in values) as a file and shows it in Finder. */
  captureSample(note?: string): Promise<{ file: string; fields: number }>;
  clearMarks(): Promise<void>;
  capturePage(): Promise<DesktopBridgeCapturedPage>;
  exportFormStructure(): Promise<{ path: string; fields: number; frames: number }>;
  chooseDirectory(): Promise<string | null>;
  exportDocument(payload: { format: "pdf" | "doc"; html: string; fileName: string }): Promise<{ path: string }>;
  openExtensionFolder(): Promise<{ path: string }>;
  screenshot(): Promise<{ dataUrl: string; url: string; title: string }>;
  /** A still of the visible page, shown while App menus cover it; null when unavailable. */
  previewFrame(): Promise<string | null>;
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
  // Saved passwords (missing before v1.14).
  loginState?(tabId: number): Promise<LoginState | null>;
  loginSave?(tabId: number): Promise<{ ok: boolean; site?: string; message?: string }>;
  loginDismiss?(tabId: number): Promise<void>;
  loginNever?(tabId: number): Promise<{ ok: boolean }>;
  loginFill?(tabId: number, loginId: string): Promise<{ ok: boolean; username?: string; message?: string }>;
  logins?(): Promise<{ logins: SavedLogin[]; never: { realm: string; site: string }[] }>;
  loginReveal?(id: string): Promise<{ ok: boolean; password?: string; message?: string }>;
  loginCopy?(id: string): Promise<{ ok: boolean; message?: string }>;
  loginDelete?(id: string): Promise<{ ok: boolean }>;
  loginNeverRemove?(realm: string): Promise<void>;
  onLoginOffer?(callback: (payload: LoginOffer) => void): () => void;
  onLoginState?(callback: (payload: { tabId: number; state: LoginState | null }) => void): () => void;
};

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

export {};
