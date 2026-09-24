const RELEASES_URL = "https://github.com/yihongchen772-alt/careerplatform-local/releases/latest";
const LATEST_RELEASE_API = "https://api.github.com/repos/yihongchen772-alt/careerplatform-local/releases/latest";
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const CHANNELS = {
  state: "updates:get-state",
  check: "updates:check",
  download: "updates:download",
  install: "updates:install",
  releases: "updates:open-releases",
  changed: "updates:state",
};

// The second argument is a test seam. Renderer code cannot supply any of it.
function setupUpdater({ app, ipcMain, getMainWindow, beforeInstall, getProxyUrl = () => undefined, trustedOrigin = "http://localhost:3210" }, runtime = {}) {
  const platform = runtime.platform ?? process.platform;
  const arch = runtime.arch ?? process.arch;
  // Windows (x64) gets full in-app download+install. Mac is ad-hoc signed
  // only (no paid Apple Developer certificate/notarization), so Squirrel.Mac
  // cannot apply the update. Mac checks the published DMG release instead.
  const mode = !app.isPackaged
    ? "development"
    : platform === "win32" && arch === "x64"
      ? "in-app"
      : platform === "darwin"
        ? "check-only"
        : "manual";
  const checkCapable = mode === "in-app" || mode === "check-only";
  const updater = checkCapable ? runtime.autoUpdater ?? require("electron-updater").autoUpdater : null;
  const networkSession = checkCapable ? runtime.networkSession ?? updater.netSession : null;
  const openExternal = runtime.openExternal ?? require("electron").shell.openExternal;
  let busy = null;
  let disposed = false;
  let downloaded = false;
  let state = {
    revision: 0,
    currentVersion: app.getVersion(),
    availableVersion: null,
    platform,
    arch,
    mode,
    status: checkCapable ? "idle" : "unsupported",
    progress: null,
    errorStage: null,
    message: mode === "in-app"
      ? "点击检查更新，发现新版本后由你选择下载和安装。"
      : mode === "check-only"
        ? "点击检查更新——发现新版本后请前往发布页面下载 DMG，退出应用后拖到「应用程序」替换（暂不支持应用内自动安装）。"
        : mode === "development"
          ? "当前是开发版，请下载安装包后使用桌面更新功能。"
          : "请从发布页面下载适合这台电脑的安装包。",
  };

  function snapshot() {
    return { ...state, progress: state.progress ? { ...state.progress } : null };
  }

  function isTrustedWindow(contents) {
    try {
      return new URL(contents.getURL()).origin === trustedOrigin;
    } catch {
      return false;
    }
  }

  function publish(patch) {
    if (disposed) return;
    state = { ...state, ...patch, revision: state.revision + 1 };
    const window = getMainWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && isTrustedWindow(window.webContents)) {
      // The user may close the window while a download event is in flight.
      try { window.webContents.send(CHANNELS.changed, snapshot()); } catch { /* Reconnect with get-state. */ }
    }
  }

  function assertTrusted(event) {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.sender.isDestroyed()) {
      throw new Error("仅允许求职罗盘主窗口操作更新。");
    }
    const frame = event.senderFrame;
    // Embedded application websites and iframes must never control installation.
    if (!frame || frame !== window.webContents.mainFrame || !isTrustedWindow(event.sender)) {
      throw new Error("更新请求来源不受信任。");
    }
    try {
      if (new URL(frame.url).origin !== trustedOrigin) throw new Error("origin");
    } catch {
      throw new Error("更新请求来源不受信任。");
    }
  }

  function fail(stage) {
    publish({
      status: "error",
      errorStage: stage,
      progress: null,
      message: stage === "download"
        ? "下载失败或文件校验未通过，请检查网络后重试下载，也可以前往发布页面下载安装包。"
        : stage === "install"
          ? "未能完成更新准备或启动安装。请重试；若应用无法继续使用，请退出后重新打开。"
          : "暂时无法检查更新。请检查网络，或前往发布页面确认新版本已发布并包含更新文件。",
    });
  }

  async function configureNetwork() {
    const raw = getProxyUrl();
    let proxy;
    if (typeof raw === "string" && raw.trim()) {
      const url = new URL(raw.trim());
      if (url.protocol !== "http:" || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Invalid update proxy");
      }
      const address = `${url.hostname}:${url.port || "80"}`;
      proxy = { mode: "fixed_servers", proxyRules: `http=${address};https=${address}` };
    } else {
      proxy = { mode: "system" };
    }
    await networkSession.setProxy(proxy);
  }

  // Mac publishes a DMG only: there is no latest-mac.yml for electron-updater
  // to read. Check the published release instead, using Chromium's network
  // session so the same system/user proxy works on both platforms.
  async function checkMacRelease() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await networkSession.fetch(LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Release lookup failed");
      const release = await response.json();
      const version = typeof release?.tag_name === "string" ? release.tag_name.replace(/^v/, "") : "";
      if (!VERSION_RE.test(version) || release.draft || release.prerelease ||
          !Array.isArray(release.assets) ||
          !release.assets.some((asset) => asset.name === `JobCompass-${version}-mac-arm64.dmg`)) {
        throw new Error("Invalid or incomplete release");
      }
      const current = app.getVersion();
      if (!VERSION_RE.test(current)) throw new Error("Invalid installed version");
      const newer = version.split(".").some((part, index) => {
        const currentPart = Number(current.split(".")[index]);
        const nextPart = Number(part);
        return nextPart > currentPart && version.split(".").slice(0, index).every((prior, i) => Number(prior) === Number(current.split(".")[i]));
      });
      if (newer) {
        publish({ status: "available", availableVersion: version, message: `发现新版本 ${version}，请前往发布页面下载 DMG 并替换应用。` });
      } else {
        publish({ status: "not-available", availableVersion: null, message: "当前已是可获取的最新正式版本。" });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const listeners = [];
  function listen(event, callback) {
    updater.on(event, callback);
    listeners.push([event, callback]);
  }

  if (updater) {
    // electron-updater 6.x / electron-builder 26 API. The generated app-update.yml
    // pins the GitHub release source; never accept a feed URL from the renderer.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    listen("update-available", (info) => {
      if (busy !== "check") return;
      if (typeof info?.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(info.version) || info.version.length > 80) {
        fail("check");
        return;
      }
      publish({
        status: "available",
        availableVersion: info.version,
        message: mode === "in-app"
          ? `发现新版本 ${info.version}，可下载后选择重启安装。`
          : `发现新版本 ${info.version}，请前往发布页面下载 DMG 并替换应用。`,
      });
    });
    listen("update-not-available", () => {
      if (busy !== "check") return;
      publish({ status: "not-available", availableVersion: null, message: "当前已是可获取的最新正式版本。" });
    });
    listen("download-progress", (progress) => {
      if (busy !== "download" || state.status !== "downloading") return;
      const finite = (value) => Number.isFinite(value) ? Math.max(0, value) : 0;
      publish({ progress: {
        percent: Math.min(100, finite(progress.percent)),
        transferred: finite(progress.transferred),
        total: finite(progress.total),
        bytesPerSecond: finite(progress.bytesPerSecond),
      } });
    });
    listen("update-downloaded", () => {
      if (busy !== "download" || state.status !== "downloading") return;
      downloaded = true;
      publish({ status: "downloaded", progress: null, message: "更新已下载。保存正在编辑的内容后，点击「重启并安装」。" });
    });
    listen("update-cancelled", () => {
      if (busy === "download") fail("download");
    });
    listen("error", () => {
      if (busy || state.status === "installing") fail(busy ?? "install");
    });
  }

  async function check() {
    if (!checkCapable || busy || downloaded || state.status === "installing") return snapshot();
    busy = "check";
    publish({ status: "checking", availableVersion: null, progress: null, errorStage: null, message: "正在检查 GitHub 发布的新版本…" });
    try {
      await configureNetwork();
      if (mode === "check-only") await checkMacRelease();
      else await updater.checkForUpdates();
      if (state.status === "checking") fail("check");
    } catch {
      fail("check");
    } finally {
      busy = null;
    }
    return snapshot();
  }

  async function download() {
    if (mode !== "in-app" || busy || downloaded || !state.availableVersion || !(state.status === "available" || state.status === "error" && state.errorStage === "download")) return snapshot();
    busy = "download";
    publish({ status: "downloading", errorStage: null, progress: null, message: "正在下载更新，下载完成后由你选择安装时间。" });
    try {
      await configureNetwork();
      await updater.downloadUpdate();
      if (state.status === "downloading") fail("download");
    } catch {
      downloaded = false;
      fail("download");
    } finally {
      busy = null;
    }
    return snapshot();
  }

  async function install() {
    if (mode !== "in-app" || busy || !downloaded || !(state.status === "downloaded" || state.status === "error" && state.errorStage === "install")) return snapshot();
    busy = "install";
    publish({ status: "installing", errorStage: null, message: "正在准备更新并备份本地数据，即将重启安装…" });
    try {
      // The host backs up the database/secret/uploads, stops its child server,
      // and enables quitting before the updater starts closing windows.
      if (typeof beforeInstall !== "function") throw new Error("Missing data backup hook");
      await beforeInstall();
      if (!disposed) updater.quitAndInstall(true, true);
    } catch {
      fail("install");
    } finally {
      busy = null;
    }
    return snapshot();
  }

  const handlers = new Map([
    [CHANNELS.state, () => snapshot()],
    [CHANNELS.check, check],
    [CHANNELS.download, download],
    [CHANNELS.install, install],
    [CHANNELS.releases, async () => { await openExternal(RELEASES_URL); return snapshot(); }],
  ]);
  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, async (event) => {
      assertTrusted(event);
      return handler();
    });
  }

  return {
    getState: snapshot,
    dispose() {
      disposed = true;
      for (const channel of handlers.keys()) ipcMain.removeHandler(channel);
      for (const [event, callback] of listeners) updater.removeListener(event, callback);
    },
  };
}

module.exports = { setupUpdater, CHANNELS, RELEASES_URL };
