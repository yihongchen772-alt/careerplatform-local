export type DesktopBridgeNavState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
};

export type DesktopBridgeAutofillStatus = {
  phase: "scanning" | "ai" | "done" | "error";
  message: string;
};

export type DesktopBridgeRect = { x: number; y: number; width: number; height: number };

export type DesktopBridge = {
  navigate(url: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  setBounds(rect: DesktopBridgeRect | null): Promise<void>;
  autofill(): Promise<void>;
  onNavState(callback: (state: DesktopBridgeNavState) => void): () => void;
  onAutofillStatus(callback: (status: DesktopBridgeAutofillStatus) => void): () => void;
};

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

export {};
