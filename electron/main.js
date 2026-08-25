const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const PORT = 3210;

// Dev: this file is at <project>/electron/main.js, so the project root is one
// level up. Packaged: electron-builder copies the project into
// process.resourcesPath/app (see package.json's "build.files"/"extraResources").
function getAppRoot() {
  return isDev ? path.join(__dirname, "..") : path.join(process.resourcesPath, "app");
}

// The AI-key encryption in src/lib/crypto.ts derives its key from
// NEXTAUTH_SECRET. It has to stay the same across restarts — a fresh random
// value every launch would make previously-saved keys undecryptable — so
// it's generated once and persisted alongside the database.
function ensureSecret(userDataDir) {
  const secretFile = path.join(userDataDir, ".secret");
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, "utf8").trim();
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

// process.execPath inside Electron's main process is the Electron binary,
// not plain Node — spawning it directly on a CLI script boots another
// Electron instance (complete with GPU/network helper processes) instead of
// just running the script, which is what actually happened the first time
// this was tried (hung with no output, spawned extra Electron Helper
// processes). ELECTRON_RUN_AS_NODE tells it to behave as plain Node instead.
function nodeEnv(env) {
  return { ...env, ELECTRON_RUN_AS_NODE: "1" };
}

function runPrismaMigrate(appRoot, env) {
  return new Promise((resolve, reject) => {
    const prismaCli = path.join(appRoot, "node_modules", "prisma", "build", "index.js");
    const schemaPath = path.join(appRoot, "prisma", "schema.prisma");
    const proc = spawn(
      process.execPath,
      [prismaCli, "migrate", "deploy", "--schema", schemaPath],
      { cwd: appRoot, env: nodeEnv(env), stdio: "inherit" }
    );
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`prisma migrate deploy exited ${code}`))
    );
  });
}

let serverProcess;

async function startNextServer() {
  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  const uploadsDir = path.join(userDataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const dbPath = path.join(userDataDir, "local.db");

  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    LOCAL_UPLOADS_DIR: uploadsDir,
    NEXTAUTH_SECRET: ensureSecret(userDataDir),
    NEXTAUTH_URL: `http://localhost:${PORT}`,
    PORT: String(PORT),
    NODE_ENV: isDev ? "development" : "production",
  };

  const appRoot = getAppRoot();
  await runPrismaMigrate(appRoot, env);

  const nextCli = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
  serverProcess = spawn(
    process.execPath,
    [nextCli, isDev ? "dev" : "start", "-p", String(PORT)],
    { cwd: appRoot, env: nodeEnv(env), stdio: "inherit" }
  );

  await waitForServer(`http://localhost:${PORT}`, 30000);

  // Best-effort — a failed reminder check should never block the window from
  // opening. The route itself silently no-ops if email isn't configured or
  // nothing's urgent.
  fetch(`http://localhost:${PORT}/api/check-reminders`, { method: "POST" }).catch(() => {});
}

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url)
        .then(() => resolve())
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

function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: "秋招追踪",
    backgroundColor: "#ffffff",
    show,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
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
  return path.join(app.getPath("userData"), "app-settings.json");
}

function readAppSettings() {
  try {
    return {
      autoLaunch: false,
      backgroundReminders: false,
      inboxScanIntervalHours: 0,
      ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")),
    };
  } catch {
    return { autoLaunch: false, backgroundReminders: false, inboxScanIntervalHours: 0 };
  }
}

function writeAutoLaunchStatus(failed) {
  // Reported back through the same shared file the UI reads, so a refusal by
  // the OS (sandboxing, MDM policy, unsigned build) shows up as a warning in
  // settings instead of a checkbox that looks on but does nothing.
  try {
    const current = readAppSettings();
    if (!!current.autoLaunchFailed === !!failed) return;
    fs.writeFileSync(
      settingsFile(),
      JSON.stringify({ ...current, autoLaunchFailed: !!failed }, null, 2)
    );
  } catch (err) {
    console.error("[autolaunch] could not record status", err);
  }
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

// ---------- tray ----------

let tray = null;

function buildTray() {
  if (tray) return;
  const { Tray, Menu, nativeImage } = require("electron");

  // A tiny transparent-background dot: bundling a separate .png into
  // extraResources for this is more moving parts than it's worth, and an
  // empty image renders as a blank gap in the menu bar on macOS.
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVR42mNkYPhfz0AEYBxVSF+FjEQq/M9ArEJGYhX+Z2AgUiEjsQr/MzAQqZCRWIX/GRiIVMhIrML/DAxEKmQkVuF/BgYiFTISq/A/AwORChmJVfifAQCk0hP9k0zi7QAAAABJRU5ErkJggg=="
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("秋招追踪");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开秋招追踪", click: showWindow },
      { label: "立即检查提醒", click: () => checkReminders(true) },
      {
        label: "立即扫描收件箱",
        click: () => {
          lastScanAt = 0;
          maybeScanInbox();
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
  tray.on("click", showWindow);
}

// ---------- background reminder loop ----------

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
let reminderTimer = null;
// Ids already surfaced, so a still-overdue item doesn't re-notify every
// 30 minutes for days on end.
const notified = new Set();

async function checkReminders(force = false) {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/reminders/due`);
    if (!res.ok) return;
    const { urgent } = await res.json();
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
let lastScanAt = 0;

async function maybeScanInbox() {
  const hours = Number(readAppSettings().inboxScanIntervalHours) || 0;
  if (hours <= 0) return;
  if (Date.now() - lastScanAt < hours * 3600 * 1000) return;
  lastScanAt = Date.now();
  try {
    await fetch(`http://localhost:${PORT}/api/check-reminders`, { method: "POST" });
  } catch {
    // Server not up yet, or transient — the next tick retries.
  }
}

function startScanLoop() {
  if (scanTimer) return;
  // Checked every 5 minutes; maybeScanInbox decides whether enough time has
  // passed. That keeps a newly-shortened interval from waiting out the old one.
  scanTimer = setInterval(maybeScanInbox, 5 * 60 * 1000);
}

function startReminderLoop() {
  if (reminderTimer) return;
  checkReminders();
  reminderTimer = setInterval(() => {
    if (readAppSettings().backgroundReminders) checkReminders();
  }, CHECK_INTERVAL_MS);
}

let isQuitting = false;

app.whenReady().then(async () => {
  try {
    await startNextServer();

    const settings = readAppSettings();
    applyAutoLaunch(settings.autoLaunch);

    // Launched by the OS at login: start parked in the tray rather than
    // popping a window in the user's face on every boot.
    const openedAtLogin =
      !isDev && app.getLoginItemSettings().wasOpenedAtLogin && settings.backgroundReminders;
    createWindow({ show: !openedAtLogin });

    if (settings.backgroundReminders) {
      buildTray();
      startReminderLoop();
      startScanLoop();
    }
  } catch (err) {
    dialog.showErrorBox("启动失败", String(err && err.message ? err.message : err));
    app.quit();
  }

  app.on("activate", showWindow);
});

function shutdown() {
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
}

app.on("window-all-closed", () => {
  // With the tray running the app deliberately outlives its windows.
  if (readAppSettings().backgroundReminders && !isQuitting) return;
  shutdown();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  shutdown();
});
