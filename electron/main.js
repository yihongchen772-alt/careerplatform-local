const { app, BrowserWindow, dialog, systemPreferences, shell, ipcMain, Menu, nativeTheme, session } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { setupBrowserViewIpc, switchBrowserProfile, getActiveBrowserPartition } = require("./browser-view");
const { setupUpdater } = require("./updater");
const { createApplicationSyncSchedule } = require("./application-sync-schedule");
const { startRenderBridge } = require("./render-bridge");
const { hasPendingMigrations } = require("./migration-guard.cjs");
const { upcomingMenuItems, trayTooltip, profileSwitchMenuItems } = require("./tray-menu");
const {
  DEFAULT_PROFILE_ID,
  browserPartitionForProfile,
  resolveProfileDataDir,
  readProfilesState,
  listProfilesDetailed,
  createProfile,
  renameProfile,
  setActiveProfile,
  deleteProfile,
  syncAiKeysForProfile,
  ensureProfileSecret,
} = require("./profiles.cjs");

// Pinned regardless of the app's marketing name (package.json's
// "productName", shown in the dock/menu bar/window title): app.getPath
// ("userData") is derived from app.getName(), and letting that drift with
// every rebrand would silently start a fresh empty database on the next
// name change — the user's candidate pool, applications, and encrypted AI
// keys would still exist on disk, just orphaned under the old folder name.
// Call this before anything touches app.getPath.
app.setName("careerplatform");
if (process.platform === "win32") app.setAppUserModelId("com.careerplatform.local");
if (process.env.CAREERPLATFORM_DATA_DIR) app.setPath("userData", path.resolve(process.env.CAREERPLATFORM_DATA_DIR));
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => { if (mainWindow) { mainWindow.restore(); showWindow(); } });

const isDev = !app.isPackaged;
const eventReminderToken = crypto.randomBytes(32).toString("hex");
let productivity = null;
let lanSync = null;
const PORT = process.env.CAREERPLATFORM_TEST_MODE === "1" ? Number(process.env.CAREERPLATFORM_TEST_PORT || 3210) : 3210;

// Dev: this file is at <project>/electron/main.js, so the project root is one
// level up. Packaged: electron-builder copies the project into
// process.resourcesPath/app (see package.json's "build.files"/"extraResources").
function getAppRoot() {
  return isDev ? path.join(__dirname, "..") : path.join(process.resourcesPath, "app-runtime");
}

// The AI-key encryption in src/lib/crypto.ts derives its key from
// NEXTAUTH_SECRET. It has to stay the same across restarts — a fresh random
// value every launch would make previously-saved keys undecryptable — so
// it's generated once and persisted alongside the database.
function ensureSecret(userDataDir) {
  return ensureProfileSecret(userDataDir);
}

function rootUserDataDir() {
  return app.getPath("userData");
}

function activeProfileState() {
  const rootDir = rootUserDataDir();
  const state = readProfilesState(rootDir);
  const active = state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0];
  return {
    rootDir,
    state,
    active,
    dataDir: resolveProfileDataDir(rootDir, active.id),
    partition: browserPartitionForProfile(active.id),
  };
}

function activeProfileDataDir() {
  return activeProfileState().dataDir;
}

// process.execPath inside Electron's main process is the Electron binary,
// not plain Node — spawning it directly on a CLI script boots another
// Electron instance (complete with GPU/network helper processes) instead of
// just running the script, which is what actually happened the first time
// this was tried (hung with no output, spawned extra Electron Helper
// processes). ELECTRON_RUN_AS_NODE tells it to behave as plain Node instead.
function nodeEnv(env) {
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: "1",
    // A purely local SQLite `migrate deploy` has no legitimate reason to
    // need network access at all. CHECKPOINT_DISABLE is Prisma's documented
    // env var to skip its own telemetry/update-check ping — belt-and-braces
    // alongside bundling the schema-engine binary below, since that ping is
    // exactly the kind of needless network dependency that turned into a
    // startup crash once already (see PRISMA_SCHEMA_ENGINE_BINARY).
    CHECKPOINT_DISABLE: "1",
  };
}

function runPrismaMigrate(appRoot, env) {
  return new Promise((resolve, reject) => {
    const prismaCli = path.join(appRoot, "node_modules", "prisma", "build", "index.js");
    const schemaPath = path.join(appRoot, "prisma", "schema.prisma");
    const migrateEnv = nodeEnv(env);
    // `generator client { binaryTargets }` in schema.prisma only fetches the
    // *query* engine for the listed targets — it has nothing to do with the
    // *schema* engine `migrate deploy` actually runs, which Prisma's own
    // postinstall only ever fetches for whichever platform `npm install` ran
    // on (this Mac). Without this, a packaged Windows build has no
    // schema-engine at all, so Prisma CLI falls back to downloading one over
    // the network on first launch — and a reset connection during that
    // download crashes the whole app before it opens. scripts/fetch-prisma-
    // windows-engine.cjs bundles the real thing at build time; this just
    // points the CLI straight at it so there is no discovery step, let alone
    // a network fallback, to go wrong.
    if (process.platform === "win32") {
      migrateEnv.PRISMA_SCHEMA_ENGINE_BINARY = path.join(appRoot, "node_modules", "@prisma", "engines", "schema-engine-windows.exe");
    }
    // "inherit" sends this straight to the parent's stdout/stderr, which is
    // exactly what Prisma's real error text needs — but a packaged app
    // launched by double-click (not from a terminal) has no visible stdout
    // at all, so "inherit" silently threw away the one thing anyone would
    // need to diagnose a failure: caught only because the wrapper's generic
    // "exited 1" message reached the user with no way to say more. Capture
    // the output ourselves and fold it into the rejection instead.
    const proc = spawn(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--schema", schemaPath],
      { cwd: appRoot, env: migrateEnv, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    const collect = (chunk) => {
      output += chunk;
      process.stdout.write(chunk); // still visible when run from a terminal
    };
    proc.stdout.on("data", collect);
    proc.stderr.on("data", collect);
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      // Keep only the tail: Prisma's actual error (P-code and message) is
      // always at the end, and dialog.showErrorBox has no scroll affordance
      // for a multi-thousand-character migration log.
      const tail = output.trim().split("\n").slice(-25).join("\n");
      reject(new Error(`prisma migrate deploy exited ${code}\n\n${tail}`));
    });
  });
}

// Safety net for the 秋招追踪 -> 求职罗盘 rename: app.setName() above should
// make this a no-op on every machine, but if some earlier packaged build
// ever did resolve userData under the old display name, this recovers it
// instead of the user seeing an empty database. Copies rather than moves —
// leaves the old folder untouched so a bug here can never look like data
// loss.
function migrateLegacyUserData(userDataDir) {
  if (process.env.CAREERPLATFORM_TEST_MODE === "1") return;
  if (fs.existsSync(path.join(userDataDir, "local.db"))) return;
  const legacyDir = path.join(app.getPath("appData"), "秋招追踪");
  if (!fs.existsSync(path.join(legacyDir, "local.db"))) return;

  console.log(`[migrate] found legacy data at ${legacyDir}, copying into ${userDataDir}`);
  for (const name of [".secret", "local.db", "app-settings.json"]) {
    const src = path.join(legacyDir, name);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(userDataDir, name));
  }
  const legacyUploads = path.join(legacyDir, "uploads");
  if (fs.existsSync(legacyUploads)) {
    fs.cpSync(legacyUploads, path.join(userDataDir, "uploads"), { recursive: true });
  }
}

let serverProcess;
let renderBridge;
let switchingProfilePromise = null;
let lastTrayUpcomingItems = [];

async function runDataWorker(initialize = false, targetDir = activeProfileDataDir()) {
  const dir = targetDir;
  if (!initialize && !fs.existsSync(path.join(dir, "local.db"))) return;
  await new Promise((resolve, reject) => {
    const worker = isDev ? path.join(__dirname, "backup-worker.cjs") : path.join(process.resourcesPath, "app.asar.unpacked", "electron", "backup-worker.cjs");
    const child = spawn(process.execPath, [worker, dir, ...(initialize ? ["--initialize"] : [])], { env: nodeEnv(process.env), stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error("数据备份失败，已停止更新。")));
  });
}
async function backupUserData(targetDir = activeProfileDataDir()) { await runDataWorker(false, targetDir); }

async function stopNextServer() {
  if (!serverProcess) return;
  const proc = serverProcess;
  serverProcess = null;
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        if (process.platform === "win32") proc.kill();
        else proc.kill("SIGKILL");
      } catch { /* ignore */ }
    }, 3000);
    proc.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    try {
      if (process.platform === "win32") proc.kill();
      else proc.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      resolve();
    }
  });
}

async function startNextServer() {
  const rootDir = rootUserDataDir();
  fs.mkdirSync(rootDir, { recursive: true });
  migrateLegacyUserData(rootDir);

  const { active, dataDir: userDataDir, partition } = activeProfileState();
  fs.mkdirSync(userDataDir, { recursive: true });
  const uploadsDir = path.join(userDataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const dbPath = path.join(userDataDir, "local.db");

  switchBrowserProfile({ profileId: active.id, dataDir: userDataDir });

  // The Next.js server below runs as a separate spawned process, not inside
  // Electron itself, so it has no BrowserWindow access of its own — job-radar's
  // rendered-page fetch tier calls back into this main process through this
  // bridge for that. See electron/render-bridge.js for why.
  if (!renderBridge) {
    renderBridge = await startRenderBridge({
      getApplicationPartition: () => getActiveBrowserPartition(),
    });
  }

  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    LOCAL_UPLOADS_DIR: uploadsDir,
    NEXTAUTH_SECRET: ensureSecret(userDataDir),
    DESKTOP_REMINDER_TOKEN: eventReminderToken,
    NEXTAUTH_URL: `http://localhost:${PORT}`,
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: isDev ? "development" : "production",
    CAREERPLATFORM_RENDER_BRIDGE_URL: renderBridge.url,
    CAREERPLATFORM_RENDER_BRIDGE_TOKEN: renderBridge.token,
    CAREERPLATFORM_PROFILE_ID: active.id,
    CAREERPLATFORM_PROFILE_NAME: active.name,
    CAREERPLATFORM_BROWSER_PARTITION: partition,
    // 小欧's 「找岗位」 runs the vendored career-ops fetchers from here.
    CAREERPLATFORM_CAREER_OPS_DIR: isDev ? path.join(__dirname, "career-ops") : path.join(process.resourcesPath, "app.asar.unpacked", "electron", "career-ops"),
  };

  const appRoot = getAppRoot();
  const dbExisted = fs.existsSync(dbPath);
  if (!dbExisted) await runDataWorker(true, userDataDir);
  // Back up before new migrations, including local builds that keep the same
  // package version while adding schema changes.
  const marker = path.join(userDataDir, ".last-migrated-version");
  const previousVersion = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  const migrationsPending = !dbExisted || hasPendingMigrations(dbPath, path.join(appRoot, "prisma", "migrations"));
  if (previousVersion !== app.getVersion() || migrationsPending) await backupUserData(userDataDir);
  if (migrationsPending) {
    await runPrismaMigrate(appRoot, env);
  }
  if (previousVersion !== app.getVersion()) fs.writeFileSync(marker, app.getVersion());

  // Automatically share configured AI keys from the main profile into secondary
  // profiles without overwriting any provider key explicitly set in that profile.
  if (active.id !== DEFAULT_PROFILE_ID) {
    try {
      syncAiKeysForProfile(rootDir, active.id);
    } catch (err) {
      console.error("[profiles] AI key sync warning:", err && err.message ? err.message : err);
    }
  }

  const nextCli = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
  serverProcess = spawn(
    process.execPath,
    isDev ? [nextCli, "dev", "-p", String(PORT), "--hostname", "127.0.0.1"] : [path.join(appRoot, "server.js")],
    { cwd: appRoot, env: nodeEnv(env), stdio: "inherit" }
  );

  await waitForServer(`http://localhost:${PORT}`, 90000);

  // Best-effort — a failed reminder check should never block the window from
  // opening. The route itself silently no-ops if email isn't configured or
  // nothing's urgent.
  if (process.env.CAREERPLATFORM_TEST_MODE !== "1") fetch(`http://localhost:${PORT}/api/check-reminders`, { method: "POST" }).catch(() => {});
}

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url)
        .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); resolve(); })
        .catch(() => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error("本地服务启动超时"));
          } else {
            setTimeout(attempt, 400);
          }
        });
    };
    attempt();
  });
}

let mainWindow = null;

// Registered once at module load (not inside createWindow, which can run
// again after the window is closed and reopened) so the renderer can check
// real OS-level mic authorization instead of inferring it from whether
// getUserMedia happened to throw — see the askForMediaAccess call above for
// why that inference is unreliable on macOS.
ipcMain.handle("mic:status", () => {
  if (process.platform !== "darwin") return "granted";
  return systemPreferences.getMediaAccessStatus("microphone");
});
ipcMain.handle("mic:open-settings", () => {
  if (process.platform === "darwin") {
    shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
  }
});

function uiThemeFile() {
  return path.join(app.getPath("userData"), "ui-theme.json");
}

function readUiThemePref() {
  try {
    const raw = JSON.parse(fs.readFileSync(uiThemeFile(), "utf8"));
    const mode = raw?.mode === "light" || raw?.mode === "dark" || raw?.mode === "system" ? raw.mode : "system";
    const bg = typeof raw?.backgroundColor === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.backgroundColor)
      ? raw.backgroundColor
      : null;
    return { mode, backgroundColor: bg };
  } catch {
    return { mode: "system", backgroundColor: null };
  }
}

ipcMain.handle("app:set-theme", (_e, payload) => {
  if (!payload || typeof payload !== "object") return false;
  const mode = payload.mode === "light" || payload.mode === "dark" || payload.mode === "system" ? payload.mode : "system";
  const bg = typeof payload.backgroundColor === "string" && /^#[0-9a-fA-F]{6}$/.test(payload.backgroundColor)
    ? payload.backgroundColor
    : (payload.isDark ? "#10111c" : "#f3f3fb");
  try {
    nativeTheme.themeSource = mode;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(bg);
    }
    fs.writeFileSync(uiThemeFile(), JSON.stringify({ mode, backgroundColor: bg }));
    return true;
  } catch {
    return false;
  }
});

function createWindow({ show = true } = {}) {
  const themePref = readUiThemePref();
  try { nativeTheme.themeSource = themePref.mode; } catch { /* ignore */ }
  const initialDark = themePref.mode === "dark" || (themePref.mode === "system" && nativeTheme.shouldUseDarkColors);
  const initialBg = themePref.backgroundColor || (initialDark ? "#10111c" : "#f3f3fb");
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: "求职罗盘",
    backgroundColor: initialBg,
    show: process.env.CAREERPLATFORM_TEST_MODE === "1" ? false : show,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  // The preload exposes privileged desktop operations. Keep the main window
  // on our own local app; external links belong in the system browser.
  const trustedOrigin = `http://localhost:${PORT}`;
  const isTrustedNavigation = (url) => {
    try { return new URL(url).origin === trustedOrigin; } catch { return false; }
  };
  const openExternalLink = (url) => {
    try {
      const parsed = new URL(url);
      if (["http:", "https:", "mailto:"].includes(parsed.protocol)) shell.openExternal(url).catch(() => {});
    } catch { /* Ignore malformed links. */ }
  };
  const guardNavigation = (details) => {
    if (!details.isMainFrame || isTrustedNavigation(details.url)) return;
    details.preventDefault();
    openExternalLink(details.url);
  };
  mainWindow.on("resize", applyFitZoom);
  mainWindow.webContents.on("did-finish-load", applyFitZoom);
  mainWindow.webContents.on("will-navigate", guardNavigation);
  mainWindow.webContents.on("will-redirect", guardNavigation);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalLink(url);
    return { action: "deny" };
  });
  // Spoken answers in the mock interview need getUserMedia. Electron denies
  // every permission request by default, so without this the mic button
  // fails with no visible reason. Only media is granted — anything else
  // (geolocation, notifications from the page, etc.) stays denied.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "media" || permission === "audioCapture");
    }
  );

  // This handler being granted is necessary but not sufficient on macOS:
  // it only controls whether Chromium's getUserMedia call is *allowed to
  // ask*, not whether the OS (TCC) has actually authorized this app to
  // read the microphone. Without an explicit askForMediaAccess call, an
  // app whose TCC entry is unset or stale (e.g. after an ad-hoc-signed
  // rebuild, which macOS can treat as a different binary identity) gets a
  // getUserMedia() that resolves normally but hands back a silent stream
  // instead of throwing — the mic button looks like it's recording, but
  // the "recording" is empty. Asking here, at launch, surfaces the native
  // permission prompt (or confirms it's already granted) before the user
  // ever reaches the mock interview page.
  if (process.platform === "darwin") {
    systemPreferences.askForMediaAccess("microphone").catch(() => {});
  }

  setupBrowserViewIpc(mainWindow, PORT);

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // With background reminders on, closing the window parks the app in the
  // tray instead of quitting — otherwise there'd be no process left to fire
  // a reminder, which is the entire point of the feature.
  mainWindow.on("close", (e) => {
    if (!isQuitting && readAppSettings().backgroundReminders) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  productivity?.setMainWindow(mainWindow);
  return mainWindow;
}

function showWindow() {
  if (!mainWindow) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ---------- shared settings file (written by the Next app) ----------

function settingsFile() {
  return path.join(activeProfileDataDir(), "app-settings.json");
}

function readAppSettings() {
  const defaults = {
    autoLaunch: false,
    notesAtLogin: false,
    backgroundReminders: false,
    inboxScanIntervalHours: 0,
    jobRadarIntervalHours: 0,
    applicationSyncIntervalHours: 0,
  };
  let rootDefaults = {};
  const rootFile = path.join(rootUserDataDir(), "app-settings.json");
  const activeFile = settingsFile();
  if (activeFile !== rootFile && fs.existsSync(rootFile)) {
    try {
      const parsedRoot = JSON.parse(fs.readFileSync(rootFile, "utf8"));
      if (parsedRoot && typeof parsedRoot === "object") {
        if (typeof parsedRoot.fitZoom === "boolean") rootDefaults.fitZoom = parsedRoot.fitZoom;
        if (typeof parsedRoot.proxyUrl === "string") rootDefaults.proxyUrl = parsedRoot.proxyUrl;
      }
    } catch { /* ignore */ }
  }
  try {
    return {
      ...defaults,
      ...rootDefaults,
      ...JSON.parse(fs.readFileSync(activeFile, "utf8")),
    };
  } catch {
    return {
      ...defaults,
      ...rootDefaults,
    };
  }
}

function writeAutoLaunchStatus(failed) {
  // OS status has its own file so reporting it cannot overwrite a simultaneous
  // settings save in the Next process.
  try {
    const file = path.join(app.getPath("userData"), "app-settings-status.json");
    const status = JSON.stringify({ autoLaunchFailed: !!failed });
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === status) return;
    fs.writeFileSync(file + ".tmp", status);
    fs.renameSync(file + ".tmp", file);
  } catch (err) { console.error("[autolaunch] could not record status", err); }
}

function applyAutoLaunch(enabled) {
  // Never touch login items in dev — that would register the dev binary.
  if (isDev) return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
    // Trust the OS's own read-back rather than the absence of a throw:
    // macOS can decline without raising.
    const actual = app.getLoginItemSettings().openAtLogin;
    writeAutoLaunchStatus(enabled && !actual);
  } catch (err) {
    console.error("[autolaunch] failed", err);
    writeAutoLaunchStatus(enabled);
  }
}

function setNotesAtLogin(enabled) {
  const settings = { ...readAppSettings(), notesAtLogin: enabled };
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  if (process.env.CAREERPLATFORM_TEST_MODE !== "1") applyAutoLaunch((settings.autoLaunch && settings.backgroundReminders) || enabled);
  return readAppSettings().notesAtLogin;
}

// ---------- fit the UI to the window ----------
// Narrower than the width the pages are laid out for, the whole UI scales
// down with the window (to 75% at most) instead of wrapping and scrolling.
// Zooming by hand (⌘+ / ⌘−) turns this off; 显示 → 随窗口自动缩放 turns it back on.
const DESIGN_WIDTH = 1320;
const MIN_FIT_ZOOM = 0.75;

function fitZoomEnabled() {
  return readAppSettings().fitZoom !== false;
}

function applyFitZoom() {
  if (!mainWindow || mainWindow.isDestroyed() || !fitZoomEnabled()) return;
  const [width] = mainWindow.getContentSize();
  const zoom = Math.round(Math.max(MIN_FIT_ZOOM, Math.min(1, width / DESIGN_WIDTH)) * 100) / 100;
  if (Math.abs(mainWindow.webContents.getZoomFactor() - zoom) > 0.005) mainWindow.webContents.setZoomFactor(zoom);
}

function setFitZoom(enabled) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...readAppSettings(), fitZoom: enabled }, null, 2));
  } catch (err) { console.error("[zoom] could not save", err); }
  if (enabled) applyFitZoom();
  buildApplicationMenu();
}

function zoomBy(step) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (fitZoomEnabled()) setFitZoom(false);
  const contents = mainWindow.webContents;
  contents.setZoomFactor(step === 0 ? 1 : Math.min(2, Math.max(0.5, Math.round((contents.getZoomFactor() + step) * 10) / 10)));
}

function listProfilesPayload() {
  const detailed = listProfilesDetailed(rootUserDataDir());
  return {
    activeProfileId: detailed.activeProfileId,
    switching: Boolean(switchingProfilePromise),
    profiles: detailed.profiles.map((item) => ({
      id: item.id,
      name: item.name,
      color: item.color,
      createdAt: item.createdAt,
      isDefault: item.isDefault,
      displayName: item.displayName,
      userRealName: item.userRealName,
      applicationCount: item.applicationCount,
      resumeCount: item.resumeCount,
      aiKeyCount: item.aiKeyCount,
      initialized: item.initialized,
      browserPartition: item.browserPartition,
    })),
  };
}

function updateMainWindowTitle(payload = null) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const info = payload || listProfilesPayload();
  const active = info.profiles.find((p) => p.id === info.activeProfileId);
  if (active && !active.isDefault) {
    mainWindow.setTitle(`求职罗盘 · 当前求职人：${active.displayName || active.name}`);
  } else {
    mainWindow.setTitle("求职罗盘");
  }
}

function requestCreateProfileFromMenu() {
  showWindow();
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("profiles:open-create-dialog");
    }
  }, 150);
}

function safeRouteAfterProfileSwitch(rawUrl) {
  const SAFE_TOP_SEGMENTS = new Set([
    "dashboard",
    "calendar",
    "leads",
    "pool",
    "browser",
    "applications",
    "resumes",
    "mock-interview",
    "insights",
    "tools",
    "settings",
    "companies",
    "contacts",
    "compare",
    "interviews",
    "journey",
    "library",
    "personality",
    "question-banks",
    "resume-drill",
  ]);
  try {
    const parsed = new URL(rawUrl);
    const first = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (SAFE_TOP_SEGMENTS.has(first)) return `/${first}`;
  } catch { /* ignore */ }
  return "/dashboard";
}

function showNativeSwitchOverlay(targetLabel) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const safeText = JSON.stringify(String(targetLabel || "新档案"));
  mainWindow.webContents.executeJavaScript(`(() => {
    if (document.getElementById("__cp-profile-switch-mask")) return;
    const mask = document.createElement("div");
    mask.id = "__cp-profile-switch-mask";
    mask.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.52);backdrop-filter:blur(10px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
    const card = document.createElement("div");
    card.style.cssText = "max-width:380px;padding:24px 28px;border-radius:18px;background:rgba(255,255,255,0.96);color:#0f172a;box-shadow:0 24px 60px rgba(0,0,0,0.25);text-align:center;";
    const title = document.createElement("div");
    title.style.cssText = "font-size:15px;font-weight:700;margin-bottom:6px;";
    title.textContent = "正在切换至「" + ${safeText} + "」的求职档案…";
    const sub = document.createElement("div");
    sub.style.cssText = "font-size:12px;color:#64748b;line-height:1.6;";
    sub.textContent = "正在隔离简历库、投递看板与内置浏览器登录态，并自动同步共享 AI 密钥";
    card.appendChild(title);
    card.appendChild(sub);
    mask.appendChild(card);
    document.body.appendChild(mask);
  })()`).catch(() => {});
}

function clearNativeSwitchOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(`document.getElementById("__cp-profile-switch-mask")?.remove()`).catch(() => {});
}

async function performProfileSwitch(targetProfileId) {
  if (switchingProfilePromise) {
    await switchingProfilePromise.catch(() => {});
  }
  const rootDir = rootUserDataDir();
  const before = readProfilesState(rootDir);
  const target = before.profiles.find((p) => p.id === targetProfileId);
  if (!target) {
    throw new Error("目标求职人档案不存在");
  }
  if (before.activeProfileId === target.id && serverProcess) {
    return listProfilesPayload();
  }

  const runSwitch = async () => {
    const targetDataDir = resolveProfileDataDir(rootDir, target.id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("profiles:switching", {
        switching: true,
        targetId: target.id,
        targetName: target.name,
      });
      showNativeSwitchOverlay(target.name);
    }

    try {
      // 1. Cancel in-flight background scans & reset per-profile timers/dedupe sets
      for (const controller of backgroundRequests.values()) controller.abort();
      backgroundRequests.clear();
      inboxSchedule.reset();
      radarSchedule.reset();
      applicationSyncSchedule.reset();
      postingSheetSchedule.reset();
      notified.clear();
      lastNotifiedApplicationSyncError = "";
      lastAutoBackupError = "";
      lastTrayUpcomingItems = [];
      appliedSettings = null;

      // 2. Close embedded browser tabs/popups & isolate browser session partition
      switchBrowserProfile({ profileId: target.id, dataDir: targetDataDir });
      productivity?.closeAllWindows?.();
      lanSync?.stopShare?.();

      // 3. Stop outgoing Next.js local server cleanly so SQLite handles close
      const previousUrl = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : "";
      await stopNextServer();

      // 4. Persist activeProfileId & start Next.js against the target profile's DB/secret/uploads
      setActiveProfile(rootDir, target.id);
      await startNextServer();

      // 5. Clear cookies & HTTP cache on main window to prevent stale session/user artifacts
      if (mainWindow && !mainWindow.isDestroyed()) {
        const appOrigin = `http://localhost:${PORT}`;
        await mainWindow.webContents.session.clearStorageData({ origin: appOrigin, storages: ["cookies"] }).catch(() => {});
        await mainWindow.webContents.session.clearCache().catch(() => {});
        const nextRoute = safeRouteAfterProfileSwitch(previousUrl);
        await mainWindow.loadURL(`${appOrigin}${nextRoute}`);
      }

      const nextPayload = listProfilesPayload();
      updateMainWindowTitle(nextPayload);
      buildApplicationMenu(nextPayload);
      setTrayMenu([], nextPayload);
      void refreshTrayUpcoming();
      reconcileAppSettings();

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("profiles:switching", { switching: false });
        mainWindow.webContents.send("profiles:changed", nextPayload);
      }
      return nextPayload;
    } catch (err) {
      clearNativeSwitchOverlay();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("profiles:switching", {
          switching: false,
          error: String(err && err.message ? err.message : err),
        });
      }
      throw err;
    }
  };

  switchingProfilePromise = runSwitch();
  try {
    return await switchingProfilePromise;
  } finally {
    switchingProfilePromise = null;
  }
}

function assertTrustedMainFrame(event) {
  const expectedOrigin = `http://localhost:${PORT}`;
  const frameUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
  try {
    if (new URL(frameUrl).origin !== expectedOrigin) {
      throw new Error("不受信任的调用来源");
    }
  } catch {
    throw new Error("不受信任的调用来源");
  }
}

ipcMain.handle("profiles:list", (event) => {
  assertTrustedMainFrame(event);
  const payload = listProfilesPayload();
  updateMainWindowTitle(payload);
  buildApplicationMenu(payload);
  if (tray) setTrayMenu(lastTrayUpcomingItems, payload);
  return payload;
});

ipcMain.handle("profiles:create", async (event, rawPayload) => {
  assertTrustedMainFrame(event);
  try {
    const name = typeof rawPayload?.name === "string" ? rawPayload.name : "";
    const color = typeof rawPayload?.color === "string" ? rawPayload.color : undefined;
    const switchImmediately = rawPayload?.switchImmediately !== false;
    const created = createProfile(rootUserDataDir(), { name, color });
    if (switchImmediately) {
      const state = await performProfileSwitch(created.id);
      return { ok: true, ...state, message: `已创建并切换至「${created.name}」` };
    }
    const state = listProfilesPayload();
    buildApplicationMenu(state);
    if (tray) setTrayMenu(lastTrayUpcomingItems, state);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("profiles:changed", state);
    return { ok: true, ...state, message: `已创建档案「${created.name}」` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("profiles:switch", async (event, profileId) => {
  assertTrustedMainFrame(event);
  try {
    const state = await performProfileSwitch(String(profileId || ""));
    const active = state.profiles.find((p) => p.id === state.activeProfileId);
    return { ok: true, ...state, message: `已切换至「${active?.displayName || active?.name || "目标档案"}」` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("profiles:rename", (event, profileId, newName) => {
  assertTrustedMainFrame(event);
  try {
    renameProfile(rootUserDataDir(), String(profileId || ""), String(newName || ""));
    const state = listProfilesPayload();
    updateMainWindowTitle(state);
    buildApplicationMenu(state);
    if (tray) setTrayMenu(lastTrayUpcomingItems, state);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("profiles:changed", state);
    return { ok: true, ...state, message: "档案已重命名" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("profiles:delete", async (event, profileId) => {
  assertTrustedMainFrame(event);
  try {
    const targetId = String(profileId || "");
    if (targetId === DEFAULT_PROFILE_ID) {
      return { ok: false, message: "默认主档案不可删除" };
    }
    const current = readProfilesState(rootUserDataDir());
    // If deleting the currently active profile, switch back to default FIRST so
    // the outgoing Next.js process releases all SQLite file locks cleanly.
    if (current.activeProfileId === targetId) {
      await performProfileSwitch(DEFAULT_PROFILE_ID);
    }
    const removed = deleteProfile(rootUserDataDir(), targetId);
    if (removed.partitionToClear && session && typeof session.fromPartition === "function") {
      try {
        const targetSession = session.fromPartition(removed.partitionToClear);
        await targetSession.clearStorageData();
        if (typeof targetSession.clearCache === "function") await targetSession.clearCache();
      } catch { /* ignore */ }
    }
    const state = listProfilesPayload();
    updateMainWindowTitle(state);
    buildApplicationMenu(state);
    if (tray) setTrayMenu(lastTrayUpcomingItems, state);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("profiles:changed", state);
    return { ok: true, ...state, message: "已删除该求职人档案及其隔离数据" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("profiles:sync-ai-keys", (event, targetProfileId) => {
  assertTrustedMainFrame(event);
  try {
    const rootDir = rootUserDataDir();
    const resolvedTarget = typeof targetProfileId === "string" && targetProfileId
      ? targetProfileId
      : readProfilesState(rootDir).activeProfileId;
    const outcome = syncAiKeysForProfile(rootDir, resolvedTarget, { overwrite: true });
    const state = listProfilesPayload();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("profiles:changed", state);
    return {
      ok: true,
      synced: outcome.synced,
      skipped: outcome.skipped,
      providers: outcome.providers,
      message: outcome.synced > 0
        ? `已同步 ${outcome.synced} 个 AI 服务密钥（${outcome.providers.join(" / ")}）`
        : "未检测到可同步的 AI 密钥，请先在主档案配置 AI 服务",
    };
  } catch (err) {
    return { ok: false, synced: 0, skipped: 0, message: err instanceof Error ? err.message : String(err) };
  }
});

function buildApplicationMenu(precomputedProfiles = null) {
  const profileInfo = precomputedProfiles || listProfilesPayload();
  const profileSubmenu = profileSwitchMenuItems(profileInfo.profiles, profileInfo.activeProfileId, {
    onSwitch: (id) => {
      void performProfileSwitch(id).catch((err) => {
        dialog.showErrorBox("切换求职人失败", String(err && err.message ? err.message : err));
      });
    },
    onCreateProfile: requestCreateProfileFromMenu,
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "求职罗盘", submenu: [
      { label: "关于求职罗盘", role: "about" },
      { type: "separator" },
      { label: "打开求职罗盘", click: showWindow },
      { label: "👥 切换求职人", submenu: profileSubmenu },
      { type: "separator" },
      { label: "显示便利贴", click: () => productivity?.open("notes") },
      { label: "显示日历", click: () => productivity?.open("calendar") },
      { type: "separator" },
      { label: "隐藏求职罗盘", role: "hide" },
      { label: "隐藏其他应用", role: "hideOthers" },
      { label: "显示全部", role: "unhide" },
      { type: "separator" },
      { label: "退出求职罗盘", role: "quit" },
    ] },
    { label: "编辑", submenu: [
      { label: "撤销", role: "undo" }, { label: "重做", role: "redo" }, { type: "separator" },
      { label: "剪切", role: "cut" }, { label: "复制", role: "copy" }, { label: "粘贴", role: "paste" }, { label: "全选", role: "selectAll" },
    ] },
    { label: "显示", submenu: [
      { label: "重新加载", role: "reload" }, { type: "separator" },
      { label: "随窗口自动缩放", type: "checkbox", checked: fitZoomEnabled(), click: (item) => setFitZoom(item.checked) },
      { label: "放大", accelerator: "CmdOrCtrl+=", click: () => zoomBy(0.1) },
      { label: "缩小", accelerator: "CmdOrCtrl+-", click: () => zoomBy(-0.1) },
      { label: "恢复默认大小", accelerator: "CmdOrCtrl+0", click: () => zoomBy(0) },
    ] },
    { label: "窗口", submenu: [
      { label: "最小化", role: "minimize" }, { label: "关闭窗口", role: "close" },
      { type: "separator" }, { label: "前置所有窗口", role: "front" },
    ] },
  ]));
}

// ---------- tray ----------

let tray = null;

function buildTray() {
  if (tray) return;
  const { Tray, Menu, nativeImage } = require("electron");

  // Keep tray imagery in sync with public/icon-source.svg. macOS uses a
  // monochrome template so the system can tint it for the menu bar.
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "assets", process.platform === "darwin" ? "trayTemplate.png" : "trayColor.png")
  );
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("求职罗盘");
  setTrayMenu([]);
  tray.on("click", showWindow);
  void refreshTrayUpcoming();
  // The countdowns and today's list go stale: refresh every minute, and
  // right after the machine wakes.
  setInterval(() => { void refreshTrayUpcoming(); }, 60 * 1000);
  require("electron").powerMonitor.on("resume", () => { void refreshTrayUpcoming(); });
}

function openApplicationInWindow(id, page = "") {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return;
  showWindow();
  mainWindow?.loadURL(`http://localhost:${PORT}/applications/${encodeURIComponent(id)}${page === "brief" ? "/brief" : "#interview"}`);
}

// 接下来 in the tray: today's interviews one click from their meeting
// link, without opening the window first.
async function refreshTrayUpcoming() {
  if (!tray) return;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/upcoming?days=7`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const payload = await res.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    lastTrayUpcomingItems = items;
    const profileInfo = listProfilesPayload();
    const active = profileInfo.profiles.find((p) => p.id === profileInfo.activeProfileId);
    setTrayMenu(items, profileInfo);
    tray.setToolTip(trayTooltip(payload, active));
  } catch { /* server not up yet: the next tick retries */ }
}

function setTrayMenu(upcoming, precomputedProfiles = null) {
  if (!tray) return;
  const { Menu, clipboard } = require("electron");
  const profileInfo = precomputedProfiles || listProfilesPayload();
  const profileSubmenu = profileSwitchMenuItems(profileInfo.profiles, profileInfo.activeProfileId, {
    onSwitch: (id) => {
      void performProfileSwitch(id).catch((err) => {
        dialog.showErrorBox("切换求职人失败", String(err && err.message ? err.message : err));
      });
    },
    onCreateProfile: requestCreateProfileFromMenu,
  });
  const items = upcomingMenuItems(upcoming, {
    openMeeting: (url) => { try { const parsed = new URL(url); if (parsed.protocol === "http:" || parsed.protocol === "https:") shell.openExternal(parsed.href).catch(() => {}); } catch { /* not a link */ } },
    copyText: (text) => clipboard.writeText(String(text)),
    openApplication: (id) => openApplicationInWindow(id),
    openBrief: (id) => openApplicationInWindow(id, "brief"),
    openList: () => { showWindow(); mainWindow?.loadURL(`http://localhost:${PORT}/applications`); },
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "👥 切换求职人", submenu: profileSubmenu },
      { type: "separator" },
      ...items,
      { type: "separator" },
      { label: "显示便利贴", click: () => productivity?.open("notes") },
      { label: "显示日历 / 提醒", click: () => productivity?.open("calendar") },
      { label: "快速捕获岗位 (Ctrl/Cmd+Shift+J)", click: () => productivity?.open("capture") },
      { label: "打开求职罗盘", click: showWindow },
      { label: "立即检查提醒", click: () => checkReminders(true) },
      {
        label: "立即扫描收件箱",
        click: () => {
          maybeScanInbox(true);
        },
      },
      {
        label: "立即检查岗位雷达",
        click: () => {
          maybeCheckJobRadar(true);
        },
      },
      { label: "立即检查校招信息表", click: () => { void maybeCheckPostingSheets(true); } },
      {
        label: "立即同步网申进度",
        click: () => {
          maybeSyncApplications(true);
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

// ---------- background reminder loop ----------

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
let reminderTimer = null;
let emailReminderTimer = null;
// Ids already surfaced, so a still-overdue item doesn't re-notify every
// 30 minutes for days on end.
const notified = new Set();

async function checkReminders(force = false) {
  if (!force && !readAppSettings().backgroundReminders) return;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/reminders/due`);
    if (!res.ok) return;
    const { urgent } = await res.json();
    if (!force && !readAppSettings().backgroundReminders) return;
    if (!Array.isArray(urgent) || urgent.length === 0) return;

    const fresh = force ? urgent : urgent.filter((u) => !notified.has(u.id));
    if (fresh.length === 0) return;
    fresh.forEach((u) => notified.add(u.id));

    const { Notification } = require("electron");
    if (!Notification.isSupported()) return;

    const first = fresh[0];
    new Notification({
      title: fresh.length === 1 ? "秋招提醒" : `秋招提醒（${fresh.length} 项）`,
      body:
        fresh.length === 1
          ? `${first.label} — ${first.sublabel}`
          : `${first.label} — ${first.sublabel}\n还有 ${fresh.length - 1} 项待处理`,
    })
      .on("click", showWindow)
      .show();
  } catch {
    // Server not up yet, or transient — the next tick will retry.
  }
}

// The inbox scan is metered separately from the reminder check: it costs an
// IMAP fetch plus an AI call per run, so it follows the user's chosen
// interval rather than the 30-minute reminder tick. Re-read each tick so a
// settings change takes effect without restarting.
let scanTimer = null;
const inboxSchedule = createApplicationSyncSchedule();
const radarSchedule = createApplicationSyncSchedule();
const backgroundRequests = new Map();
function backgroundRequest(kind) {
  const controller = new AbortController();
  backgroundRequests.set(kind, controller);
  return { controller, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) };
}
function backgroundAllowed(force, key) {
  const settings = readAppSettings();
  return force || (settings.backgroundReminders && Number(settings[key]) > 0);
}
async function maybeScanInbox(force = false) {
  if (!backgroundAllowed(force, "inboxScanIntervalHours")) return;
  const intervalMs = (Number(readAppSettings().inboxScanIntervalHours) || 1) * 3600000;
  if (force) inboxSchedule.reset();
  if (!inboxSchedule.begin(intervalMs)) return;
  const { controller, signal } = backgroundRequest("inbox");
  let healthy = false;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/check-reminders`, { method: "POST", signal });
    if (!res.ok) throw new Error(`inbox endpoint returned ${res.status}`);
    const outcome = await res.json();
    healthy = outcome.ok !== false && !outcome.errors?.length && !outcome.error;
    // Second failure in a row: say so once, instead of mail quietly not
    // being read for days. The banner in the App stays until it works.
    if (outcome.alert && !signal.aborted) {
      const { Notification } = require("electron");
      if (Notification.isSupported()) {
        new Notification({
          title: "自动读邮件停了，新的面试/笔试通知不会自动记进来",
          body: String(outcome.error || "收件箱扫描失败").slice(0, 180),
        }).on("click", () => { showWindow(); mainWindow?.loadURL(`http://localhost:${PORT}/settings#mail-accounts`).catch(() => {}); }).show();
      }
    }
    const progress = Number(outcome.progressUpdated) || 0;
    const scheduled = Number(outcome.scheduled) || 0;
    const recorded = Number(outcome.recorded) || 0;
    if ((progress > 0 || scheduled > 0 || recorded > 0) && !signal.aborted) {
      const { Notification } = require("electron");
      if (Notification.isSupported()) {
        const parts = [progress && `更新了 ${progress} 条投递`, scheduled && `${scheduled} 个面试/笔试时间已加入日程`, recorded && `新记了 ${recorded} 条投递`].filter(Boolean);
        new Notification({
          title: `邮件里有新进度：${parts.join("，")}`,
          body: "打开「投递记录」可以查看，认错了点「撤销」即可",
        }).on("click", showWindow).show();
      }
    }
  } catch { /* Retry within 15 minutes; do not wait a full successful interval. */ }
  finally { if (backgroundRequests.get("inbox") === controller) backgroundRequests.delete("inbox"); inboxSchedule.finish(intervalMs, healthy); }
}

// Same idea as the inbox scan, on the same company's careerUrl the user
// saved in the company directory: fetch the page's HTML, diff its extracted
// text against the last-seen hash, and surface a notification when it
// changed. The diff/hash/HTTP work all lives server-side (checkAllCompanyRadars
// in src/lib/actions/job-radar.ts) — this is just the timer that hits it.
async function maybeCheckJobRadar(force = false) {
  if (!backgroundAllowed(force, "jobRadarIntervalHours")) return;
  const intervalMs = (Number(readAppSettings().jobRadarIntervalHours) || 6) * 3600000;
  if (force) radarSchedule.reset();
  if (!radarSchedule.begin(intervalMs)) return;
  const { controller, signal } = backgroundRequest("radar");
  let healthy = false;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/job-radar/check`, { method: "POST", signal });
    if (!res.ok) throw new Error(`radar endpoint returned ${res.status}`);
    const { changed, errors } = await res.json();
    healthy = !errors?.length;
    if (signal.aborted || !backgroundAllowed(force, "jobRadarIntervalHours")) return;
    if (!Array.isArray(changed) || changed.length === 0) return;

    const { Notification } = require("electron");
    if (!Notification.isSupported()) return;

    const first = changed[0];
    const totalNew = changed.reduce((sum, c) => sum + (c.newCount || 0), 0);
    new Notification({
      title: changed.length === 1 ? "岗位雷达" : `岗位雷达（${changed.length} 家公司）`,
      body:
        changed.length === 1
          ? totalNew > 0
            ? `${first.name} 发现 ${totalNew} 个新岗位，去看看`
            : `${first.name} 的招聘页面有更新，去看看`
          : totalNew > 0
            ? `${first.name} 等 ${changed.length} 家公司共发现 ${totalNew} 个新岗位`
            : `${first.name} 等 ${changed.length} 家公司的招聘页面有更新`,
    })
      .on("click", showWindow)
      .show();
  } catch {
    // Server not up yet, or transient — the next tick will retry.
  } finally { if (backgroundRequests.get("radar") === controller) backgroundRequests.delete("radar"); radarSchedule.finish(intervalMs, healthy); }
}

// 网申进度同步: same timer pattern as the radar, but the page it reads is
// the company's candidate portal behind the user's own login (rendered in
// the 网申浏览器's session — see electron/render-bridge.js), and the result
// is a stage change on the user's own applications. Server-side logic in
// src/lib/actions/application-sync.ts; this is just the timer + notification.
const applicationSyncSchedule = createApplicationSyncSchedule();
let lastNotifiedApplicationSyncError = "";

async function maybeSyncApplications(force = false) {
  if (!backgroundAllowed(force, "applicationSyncIntervalHours")) return;
  const hours = Number(readAppSettings().applicationSyncIntervalHours) || 6;
  const intervalMs = hours * 3600 * 1000;
  if (force) applicationSyncSchedule.reset();
  if (!applicationSyncSchedule.begin(intervalMs)) return;
  const { controller, signal } = backgroundRequest("sync");
  let healthy = false;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/application-sync/check`, { method: "POST", signal });
    if (!res.ok) throw new Error(`sync endpoint returned ${res.status}`);
    const { changed, review, errors } = await res.json();
    const failures = Array.isArray(errors) ? errors : [];
    healthy = failures.length === 0;
    if (signal.aborted || !backgroundAllowed(force, "applicationSyncIntervalHours")) return;
    const { Notification } = require("electron");
    if (!Notification.isSupported()) return;

    if (Array.isArray(changed) && changed.length > 0) {
      const first = changed[0];
      new Notification({
        title: changed.length === 1 ? "网申进度已自动更新" : `网申进度已自动更新（${changed.length} 条）`,
        body:
          changed.length === 1
            ? `${first.companyName} · ${first.title}：官网显示「${first.portalStatus}」，认错了可在投递记录里撤销`
            : `${first.companyName} 等 ${changed.length} 条投递按官网状态更新了，打开投递记录可查看或撤销`,
      })
        .on("click", showWindow)
        .show();
    }
    if (Array.isArray(review) && review.length > 0) {
      const rejected = review.filter((item) => item.to === "REJECTED");
      new Notification({
        title: rejected.length > 0 ? `官网提示 ${rejected.length} 条投递未通过` : "网申进度需要你核对",
        body: rejected.length > 0
          ? `${rejected[0].companyName} · ${rejected[0].title}：请打开投递看板核对，确认前不会改动阶段`
          : `${review[0].companyName} 等 ${review.length} 条官网结果或非标准阶段顺序待核对，确认前不会改动阶段`,
      }).on("click", showWindow).show();
    }
    // A login that expired is the one error worth interrupting for — the
    // sync silently does nothing until the user logs back in.
    const expired = failures.filter((e) => /登录已过期/.test(e.message || ""));
    const failureKey = failures.map((e) => `${e.companyName}:${/登录已过期/.test(e.message || "") ? "login" : "other"}`).sort().join("|");
    if (expired.length > 0 && failureKey !== lastNotifiedApplicationSyncError) {
      const targetUrl = expired[0]?.portalUrl
        ? `http://localhost:${PORT}/browser?url=${encodeURIComponent(expired[0].portalUrl)}`
        : `http://localhost:${PORT}/browser`;
      new Notification({
        title: "网申进度同步：需要重新登录",
        body: `${expired.map((e) => e.companyName).join("、")} 的招聘系统登录已过期，点此打开网申浏览器重新登录`,
      })
        .on("click", () => {
          showWindow();
          mainWindow?.loadURL(targetUrl).catch(() => {});
        })
        .show();
    }
    const otherFailures = failures.filter((e) => !/登录已过期/.test(e.message || ""));
    if (otherFailures.length > 0 && failureKey !== lastNotifiedApplicationSyncError) {
      new Notification({
        title: "网申进度同步失败",
        body: `${otherFailures.map((e) => e.companyName).join("、")} 的进度页读取失败；请到投递记录查看原因，App 会稍后重试`,
      }).on("click", showWindow).show();
    }
    lastNotifiedApplicationSyncError = failureKey;
  } catch {
    if (signal.aborted || !backgroundAllowed(force, "applicationSyncIntervalHours")) return;
    if (lastNotifiedApplicationSyncError !== "service") {
      const { Notification } = require("electron");
      if (Notification.isSupported()) new Notification({
        title: "网申进度同步暂时不可用",
        body: "本地同步服务没有响应，App 会在 15 分钟内重试；也可稍后到投递记录手动同步",
      }).on("click", showWindow).show();
    }
    lastNotifiedApplicationSyncError = "service";
  } finally {
    if (backgroundRequests.get("sync") === controller) backgroundRequests.delete("sync");
    applicationSyncSchedule.finish(intervalMs, healthy);
  }
}

// 自动备份 (settings → 数据备份): the server decides whether a backup is due
// from the user's own interval; this only knocks every 30 minutes while the
// app runs, and notifies once per distinct failure.
let autoBackupTimer;
let lastAutoBackupError = "";
async function maybeAutoBackup() {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/backup-schedule/run`, { method: "POST" });
    if (!res.ok) return;
    const outcome = await res.json();
    const error = outcome && outcome.ran && outcome.error ? String(outcome.error) : "";
    if (error && error !== lastAutoBackupError) {
      const { Notification } = require("electron");
      if (Notification.isSupported()) {
        new Notification({ title: "自动备份失败", body: `${error.slice(0, 120)}。到账号设置 → 数据备份查看。` }).on("click", showWindow).show();
      }
    }
    if (outcome && outcome.ran) lastAutoBackupError = error;
  } catch {
    // Server not up yet — the next tick retries.
  }
}

function startAutoBackupLoop() {
  if (autoBackupTimer) return;
  setTimeout(maybeAutoBackup, 2 * 60 * 1000);
  autoBackupTimer = setInterval(maybeAutoBackup, 30 * 60 * 1000);
}

function startScanLoop() {
  if (scanTimer) return;
  // Checked every 5 minutes; maybeScanInbox/maybeCheckJobRadar each decide
  // whether enough time has passed for their own interval. That keeps a
  // newly-shortened interval from waiting out the old one.
  scanTimer = setInterval(() => {
    maybeScanInbox();
    maybeCheckJobRadar();
    maybeSyncApplications();
  }, 5 * 60 * 1000);
}

// 校招信息表 subscribed in 秋招信息库: every hour (settings: postingSheetIntervalHours;
// 0 = only when the page is opened) while the App runs, tray included. The
// check itself is one small request per sheet; only a changed sheet is read in full.
const postingSheetSchedule = createApplicationSyncSchedule();
let postingSheetTimer = null;
async function maybeCheckPostingSheets(force = false) {
  const hours = Number(readAppSettings().postingSheetIntervalHours ?? 1);
  if (!force && !(hours > 0)) return;
  const intervalMs = (hours > 0 ? hours : 1) * 3600000;
  if (force) postingSheetSchedule.reset();
  if (!postingSheetSchedule.begin(intervalMs)) return;
  let healthy = false;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/postings/check`, { method: "POST", signal: AbortSignal.timeout(300000) });
    if (!res.ok) throw new Error(`postings endpoint returned ${res.status}`);
    const outcome = await res.json();
    healthy = !outcome.errors?.length;
    const fresh = (outcome.synced || []).filter((sheet) => sheet.fresh > 0);
    const { Notification } = require("electron");
    if (fresh.length && Notification.isSupported()) {
      const added = fresh.reduce((sum, sheet) => sum + sheet.fresh, 0);
      const mine = fresh.reduce((sum, sheet) => sum + sheet.freshMine, 0);
      const closing = fresh.reduce((sum, sheet) => sum + sheet.freshClosing, 0);
      new Notification({
        title: `校招信息表更新：新增 ${added} 条`,
        body: mine ? `适合你这一届的 ${mine} 条${closing ? `，其中 ${closing} 条 7 天内截止` : ""}。点开查看` : "都不是你这一届的，点开可以查看",
      }).on("click", () => { showWindow(); mainWindow?.loadURL(`http://localhost:${PORT}/leads?view=postings&fresh=1`).catch(() => {}); }).show();
    }
  } catch { /* Tried again within 15 minutes. */ }
  finally { postingSheetSchedule.finish(intervalMs, healthy); }
}
function startPostingSheetLoop() {
  if (postingSheetTimer || process.env.CAREERPLATFORM_TEST_MODE === "1") return;
  // A first look two minutes after launch, then the 5-minute tick lets the schedule decide.
  setTimeout(() => { void maybeCheckPostingSheets(); }, 2 * 60 * 1000);
  postingSheetTimer = setInterval(() => { void maybeCheckPostingSheets(); }, 5 * 60 * 1000);
}

function startEmailReminderLoop() {
  if (emailReminderTimer) return;
  if (process.env.CAREERPLATFORM_TEST_MODE !== "1") {
    let checkingEmail = false;
    emailReminderTimer = setInterval(async () => {
      if (checkingEmail || (!readAppSettings().backgroundReminders && (!mainWindow || mainWindow.isDestroyed()))) return;
      checkingEmail = true;
      try { await fetch(`http://localhost:${PORT}/api/check-email-reminders`, { method: "POST", signal: AbortSignal.timeout(180000) }); }
      catch { /* Retry on the next tick; the database deduplicates delivery. */ }
      finally { checkingEmail = false; }
    }, 60000);
  }
}

function startReminderLoop() {
  if (reminderTimer) return;
  checkReminders();

  reminderTimer = setInterval(() => {
    if (readAppSettings().backgroundReminders) checkReminders();
  }, CHECK_INTERVAL_MS);
}

let settingsTimer = null;
let appliedSettings = null;
function reconcileAppSettings() {
  const settings = readAppSettings();
  if (process.env.CAREERPLATFORM_TEST_MODE === "1") return;
  if (!appliedSettings || settings.autoLaunch !== appliedSettings.autoLaunch || settings.notesAtLogin !== appliedSettings.notesAtLogin || settings.backgroundReminders !== appliedSettings.backgroundReminders) {
    applyAutoLaunch((settings.autoLaunch && settings.backgroundReminders) || settings.notesAtLogin);
  }
  for (const [kind, key, schedule] of [["inbox", "inboxScanIntervalHours", inboxSchedule], ["radar", "jobRadarIntervalHours", radarSchedule], ["sync", "applicationSyncIntervalHours", applicationSyncSchedule]]) {
    if (!appliedSettings || settings[key] !== appliedSettings[key] || settings.backgroundReminders !== appliedSettings.backgroundReminders) {
      backgroundRequests.get(kind)?.abort(); schedule.reset();
    }
  }
  if (settings.backgroundReminders) { startReminderLoop(); startScanLoop(); }
  else {
    if (reminderTimer) { clearInterval(reminderTimer); reminderTimer = null; }
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  }
  appliedSettings = settings;
}
function startSettingsLoop() {
  reconcileAppSettings();
  if (!settingsTimer && process.env.CAREERPLATFORM_TEST_MODE !== "1") settingsTimer = setInterval(reconcileAppSettings, 1000);
}

let isQuitting = false;

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  try {
    // Opening the DMG's app directly (instead of dragging it into
    // Applications first) runs it under macOS's App Translocation — a
    // read-only mount at a randomized /private/var/folders/.../
    // AppTranslocation/... path. Everything under Contents/Resources is
    // read-only there, including bundled binaries like the Prisma query
    // engine — something inside `prisma migrate deploy` tries to touch one
    // of those and fails with a confusing "EROFS: read-only file system,
    // unlink ...libquery_engine..." instead of anything pointing at the
    // real cause. moveToApplicationsFolder() (macOS-only, no-ops if already
    // in /Applications) sidesteps translocation entirely instead of chasing
    // every read that might fail under it. It shows NO dialog by default —
    // Electron's own docs recommend confirming first via the dialog API
    // rather than silently relocating and relaunching a data-holding app
    // out from under the user.
    if (!isDev && process.platform === "darwin" && process.env.CAREERPLATFORM_TEST_MODE !== "1" && !app.isInApplicationsFolder()) {
      const response = dialog.showMessageBoxSync({
        type: "question",
        buttons: ["移动并重启", "暂不"],
        defaultId: 0,
        cancelId: 1,
        title: "移动到应用程序文件夹",
        message: "求职罗盘看起来是从下载的磁盘镜像直接打开的，不是安装到「应用程序」文件夹。",
        detail: "直接从镜像运行时，macOS 会把它挂载成只读状态，部分启动步骤会失败。建议现在移动到「应用程序」文件夹并重启 App；选择「暂不」会继续尝试直接运行，可能遇到启动失败。",
      });
      // response 0 = "移动并重启". A throw here means the move itself failed
      // (not a user cancel, which just returns false) — worth surfacing
      // through the same catch/dialog below rather than silently continuing
      // translocated.
      if (response === 0) app.moveToApplicationsFolder();
    }

    await startNextServer();

    const settings = readAppSettings();

    // Launched by the OS at login: start parked in the tray rather than
    // popping a window in the user's face on every boot.
    const openedAtLogin =
      !isDev && app.getLoginItemSettings().wasOpenedAtLogin && (settings.backgroundReminders || settings.notesAtLogin);
    let restoreMainVisible = true;
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "desktop-windows.json"), "utf8"));
      if (saved.mainVisible === false && saved.windows?.some((window) => window.visible)) restoreMainVisible = false;
    } catch { /* First launch or older window state. */ }
    createWindow({ show: !openedAtLogin && restoreMainVisible });
    updateMainWindowTitle();
    productivity = require("./productivity").setupProductivity({ port: PORT, token: eventReminderToken, getMainWindow: () => mainWindow, showMainWindow: showWindow, getNotesAtLogin: () => readAppSettings().notesAtLogin, setNotesAtLogin, openNotesAtLogin: openedAtLogin && settings.notesAtLogin });
    lanSync = require("./lan-sync").setupLanSync({ port: PORT, token: eventReminderToken, ipcMain, trustedOrigin: `http://localhost:${PORT}` });
    buildApplicationMenu();
    if (process.env.CAREERPLATFORM_TEST_MODE !== "1") buildTray();
    const updaterController = setupUpdater({
      app,
      ipcMain: require("electron").ipcMain,
      getMainWindow: () => mainWindow,
      getProxyUrl: () => readAppSettings().proxyUrl,
      trustedOrigin: `http://localhost:${PORT}`,
      beforeInstall: async () => {
        await backupUserData();
        isQuitting = true;
        shutdown();
      },
    });
    if (app.isPackaged && process.env.CAREERPLATFORM_TEST_MODE !== "1") {
      // Idle check-only ping shortly after startup; never auto-downloads or installs.
      setTimeout(() => { updaterController.check().catch(() => {}); }, 15000).unref();
    }

    // Never in test mode: an isolated copy of real data still carries the
    // user's real backup folder and WebDAV settings.
    if (process.env.CAREERPLATFORM_TEST_MODE !== "1") startAutoBackupLoop();
    startEmailReminderLoop();
    startPostingSheetLoop();
    // After an app update, bring an already-installed unpacked extension copy
    // up to the new version (Chrome picks it up on its next reload/restart).
    try {
      require("./browser-view").syncChromeExtension();
    } catch {
      // Never block startup on the optional extension copy.
    }
    startSettingsLoop();
  } catch (err) {
    dialog.showErrorBox("启动失败", String(err && err.message ? err.message : err));
    app.quit();
  }

  app.on("activate", showWindow);
});

function shutdown() {
  if (settingsTimer) { clearInterval(settingsTimer); settingsTimer = null; }
  for (const controller of backgroundRequests.values()) controller.abort();
  if (autoBackupTimer) { clearInterval(autoBackupTimer); autoBackupTimer = null; }
  productivity?.shutdown();
  lanSync?.shutdown();
  if (emailReminderTimer) { clearInterval(emailReminderTimer); emailReminderTimer = null; }
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (renderBridge) {
    renderBridge.close();
    renderBridge = null;
  }
}

app.on("window-all-closed", () => {
  // With the tray running the app deliberately outlives its windows.
  if (readAppSettings().backgroundReminders && !isQuitting) return;
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  shutdown();
});
