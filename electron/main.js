const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");

// Pinned regardless of the app's marketing name (package.json's
// "productName", shown in the dock/menu bar/window title): app.getPath
// ("userData") is derived from app.getName(), and letting that drift with
// every rebrand would silently start a fresh empty database on the next
// name change — the user's candidate pool, applications, and encrypted AI
// keys would still exist on disk, just orphaned under the old folder name.
// Call this before anything touches app.getPath.
app.setName("careerplatform");

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

// Safety net for the 秋招追踪 -> 求职罗盘 rename: app.setName() above should
// make this a no-op on every machine, but if some earlier packaged build
// ever did resolve userData under the old display name, this recovers it
// instead of the user seeing an empty database. Copies rather than moves —
// leaves the old folder untouched so a bug here can never look like data
// loss.
function migrateLegacyUserData(userDataDir) {
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

async function startNextServer() {
  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  migrateLegacyUserData(userDataDir);
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
    title: "求职罗盘",
    backgroundColor: "#ffffff",
    show,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
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

  // The compass mark at 64px, inlined as base64 rather than pulled from
  // extraResources — one fewer moving part, and it's small enough not to
  // matter. Regenerate from public/icon-source.svg if the mark ever changes:
  //   rsvg-convert -w 64 -h 64 public/icon-source.svg | base64
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,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"
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("求职罗盘");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开求职罗盘", click: showWindow },
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
