const { app, BrowserWindow, dialog, systemPreferences, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { setupBrowserViewIpc } = require("./browser-view");
const { setupUpdater } = require("./updater");
const { startRenderBridge } = require("./render-bridge");

// Pinned regardless of the app's marketing name (package.json's
// "productName", shown in the dock/menu bar/window title): app.getPath
// ("userData") is derived from app.getName(), and letting that drift with
// every rebrand would silently start a fresh empty database on the next
// name change — the user's candidate pool, applications, and encrypted AI
// keys would still exist on disk, just orphaned under the old folder name.
// Call this before anything touches app.getPath.
app.setName("careerplatform");
if (process.env.CAREERPLATFORM_DATA_DIR) app.setPath("userData", path.resolve(process.env.CAREERPLATFORM_DATA_DIR));
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => { if (mainWindow) { mainWindow.restore(); showWindow(); } });

const isDev = !app.isPackaged;
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

async function runDataWorker(initialize = false) {
  const dir = app.getPath("userData");
  if (!initialize && !fs.existsSync(path.join(dir, "local.db"))) return;
  await new Promise((resolve, reject) => {
    const worker = isDev ? path.join(__dirname, "backup-worker.cjs") : path.join(process.resourcesPath, "app.asar.unpacked", "electron", "backup-worker.cjs");
    const child = spawn(process.execPath, [worker, dir, ...(initialize ? ["--initialize"] : [])], { env: nodeEnv(process.env), stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error("数据备份失败，已停止更新。")));
  });
}
async function backupUserData() { await runDataWorker(); }

async function startNextServer() {
  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  migrateLegacyUserData(userDataDir);
  const uploadsDir = path.join(userDataDir, "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const dbPath = path.join(userDataDir, "local.db");

  // The Next.js server below runs as a separate spawned process, not inside
  // Electron itself, so it has no BrowserWindow access of its own — job-radar's
  // rendered-page fetch tier calls back into this main process through this
  // bridge for that. See electron/render-bridge.js for why.
  renderBridge = await startRenderBridge();

  const env = {
    ...process.env,
    DATABASE_URL: `file:${dbPath}`,
    LOCAL_UPLOADS_DIR: uploadsDir,
    NEXTAUTH_SECRET: ensureSecret(userDataDir),
    NEXTAUTH_URL: `http://localhost:${PORT}`,
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: isDev ? "development" : "production",
    CAREERPLATFORM_RENDER_BRIDGE_URL: renderBridge.url,
    CAREERPLATFORM_RENDER_BRIDGE_TOKEN: renderBridge.token,
  };

  const appRoot = getAppRoot();
  if (!fs.existsSync(dbPath)) await runDataWorker(true);
  // Back up once per app version before any new migrations touch user data.
  const marker = path.join(userDataDir, ".last-migrated-version");
  const previousVersion = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "";
  if (previousVersion !== app.getVersion()) await backupUserData();
  await runPrismaMigrate(appRoot, env);
  fs.writeFileSync(marker, app.getVersion());

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

function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: "求职罗盘",
    backgroundColor: "#ffffff",
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
      jobRadarIntervalHours: 0,
      applicationSyncIntervalHours: 0,
      ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")),
    };
  } catch {
    return {
      autoLaunch: false,
      backgroundReminders: false,
      inboxScanIntervalHours: 0,
      jobRadarIntervalHours: 0,
      applicationSyncIntervalHours: 0,
    };
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

  // Keep tray imagery in sync with public/icon-source.svg. macOS uses a
  // monochrome template so the system can tint it for the menu bar.
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "assets", process.platform === "darwin" ? "trayTemplate.png" : "trayColor.png")
  );
  if (process.platform === "darwin") icon.setTemplateImage(true);
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
      {
        label: "立即检查岗位雷达",
        click: () => {
          lastRadarCheckAt = 0;
          maybeCheckJobRadar();
        },
      },
      {
        label: "立即同步网申进度",
        click: () => {
          lastApplicationSyncAt = 0;
          maybeSyncApplications();
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

// Same idea as the inbox scan, on the same company's careerUrl the user
// saved in the company directory: fetch the page's HTML, diff its extracted
// text against the last-seen hash, and surface a notification when it
// changed. The diff/hash/HTTP work all lives server-side (checkAllCompanyRadars
// in src/lib/actions/job-radar.ts) — this is just the timer that hits it.
let lastRadarCheckAt = 0;

async function maybeCheckJobRadar() {
  const hours = Number(readAppSettings().jobRadarIntervalHours) || 0;
  if (hours <= 0) return;
  if (Date.now() - lastRadarCheckAt < hours * 3600 * 1000) return;
  lastRadarCheckAt = Date.now();
  try {
    const res = await fetch(`http://localhost:${PORT}/api/job-radar/check`, { method: "POST" });
    if (!res.ok) return;
    const { changed } = await res.json();
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
  }
}

// 网申进度同步: same timer pattern as the radar, but the page it reads is
// the company's candidate portal behind the user's own login (rendered in
// the 网申浏览器's session — see electron/render-bridge.js), and the result
// is a stage change on the user's own applications. Server-side logic in
// src/lib/actions/application-sync.ts; this is just the timer + notification.
let lastApplicationSyncAt = 0;

async function maybeSyncApplications() {
  const hours = Number(readAppSettings().applicationSyncIntervalHours) || 0;
  if (hours <= 0) return;
  if (Date.now() - lastApplicationSyncAt < hours * 3600 * 1000) return;
  lastApplicationSyncAt = Date.now();
  try {
    const res = await fetch(`http://localhost:${PORT}/api/application-sync/check`, { method: "POST" });
    if (!res.ok) return;
    const { changed, review, errors } = await res.json();
    const { Notification } = require("electron");
    if (!Notification.isSupported()) return;

    if (Array.isArray(changed) && changed.length > 0) {
      const first = changed[0];
      new Notification({
        title: changed.length === 1 ? "网申进度有更新" : `网申进度有更新（${changed.length} 条）`,
        body:
          changed.length === 1
            ? `${first.companyName} · ${first.title}：官网显示「${first.portalStatus}」`
            : `${first.companyName} 等 ${changed.length} 条投递的官网状态变了，去看板看看`,
      })
        .on("click", showWindow)
        .show();
    }
    if (Array.isArray(review) && review.length > 0) {
      new Notification({
        title: "网申进度需要你核对",
        body: `${review[0].companyName} 等 ${review.length} 条 Offer/拒绝状态已放进投递看板，确认前不会改动阶段`,
      }).on("click", showWindow).show();
    }
    // A login that expired is the one error worth interrupting for — the
    // sync silently does nothing until the user logs back in.
    const expired = Array.isArray(errors) ? errors.filter((e) => /登录已过期/.test(e.message || "")) : [];
    if (expired.length > 0) {
      new Notification({
        title: "网申进度同步：需要重新登录",
        body: `${expired.map((e) => e.companyName).join("、")} 的招聘系统登录已过期，去网申浏览器重新登录`,
      })
        .on("click", showWindow)
        .show();
    }
  } catch {
    // Server not up yet, or transient — the next tick will retry.
  }
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

function startReminderLoop() {
  if (reminderTimer) return;
  checkReminders();
  reminderTimer = setInterval(() => {
    if (readAppSettings().backgroundReminders) checkReminders();
  }, CHECK_INTERVAL_MS);
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
    if (!isDev && process.platform === "darwin" && !app.isInApplicationsFolder()) {
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
    if (process.env.CAREERPLATFORM_TEST_MODE !== "1") applyAutoLaunch(settings.autoLaunch);

    // Launched by the OS at login: start parked in the tray rather than
    // popping a window in the user's face on every boot.
    const openedAtLogin =
      !isDev && app.getLoginItemSettings().wasOpenedAtLogin && settings.backgroundReminders;
    createWindow({ show: !openedAtLogin });
    setupUpdater({
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

    if (settings.backgroundReminders && process.env.CAREERPLATFORM_TEST_MODE !== "1") {
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
  if (renderBridge) {
    renderBridge.close();
    renderBridge = null;
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
