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

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    title: "秋招追踪",
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(async () => {
  try {
    await startNextServer();
    createWindow();
  } catch (err) {
    dialog.showErrorBox("启动失败", String(err && err.message ? err.message : err));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function shutdown() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.on("window-all-closed", () => {
  shutdown();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", shutdown);
