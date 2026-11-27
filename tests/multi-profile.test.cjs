const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const ts = require("typescript");
const { DatabaseSync } = require("node:sqlite");

const {
  DEFAULT_PROFILE_ID,
  DEFAULT_BROWSER_PARTITION,
  isValidProfileId,
  browserPartitionForProfile,
  isAllowedBrowserPartition,
  resolveProfileDataDir,
  readProfilesState,
  ensureProfileSecret,
  encryptAiKeyWithSecret,
  decryptAiKeyWithSecret,
  listProfilesDetailed,
  createProfile,
  renameProfile,
  setActiveProfile,
  deleteProfile,
  syncAiKeysForProfile,
} = require("../electron/profiles.cjs");
const { profileSwitchMenuItems, trayTooltip } = require("../electron/tray-menu.js");

function createTempRoot(t) {
  const base = path.resolve(__dirname, "../.local-run/multi-profile-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  t.after(() => {
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) {
      throw new Error("Invalid cleanup target");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function loadCryptoTs(secretValue) {
  const abs = path.resolve(__dirname, "../src/lib/crypto.ts");
  const output = ts.transpileModule(fs.readFileSync(abs, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require,
    Buffer,
    Error,
    process: { env: { NEXTAUTH_SECRET: secretValue } },
  };
  vm.runInNewContext(output, sandbox);
  return mod.exports;
}

function initMinimalProfileDb(dir, { userName = "我", applications = 0, resumes = 0 } = {}) {
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "local.db"));
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL UNIQUE,
      "name" TEXT,
      "defaultAiProvider" TEXT,
      "agentAiProvider" TEXT,
      "agentAiModel" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "AiKey" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "apiKeyEncrypted" TEXT NOT NULL,
      "model" TEXT,
      "baseUrl" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "AiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE UNIQUE INDEX "AiKey_userId_provider_key" ON "AiKey"("userId", "provider");
    CREATE TABLE "Application" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "ResumeVersion" ("id" TEXT NOT NULL PRIMARY KEY);
  `);
  if (userName !== null) {
    db.prepare('INSERT INTO "User" ("id", "email", "name") VALUES (?, ?, ?)').run("local-user", "me@local", userName);
  }
  for (let i = 0; i < applications; i++) {
    db.prepare('INSERT INTO "Application" ("id") VALUES (?)').run(`app-${i}`);
  }
  for (let i = 0; i < resumes; i++) {
    db.prepare('INSERT INTO "ResumeVersion" ("id") VALUES (?)').run(`res-${i}`);
  }
  return db;
}

function loadElectronModuleWithMocks(relFile, mocks) {
  const fullPath = path.resolve(__dirname, "..", relFile);
  const code = fs.readFileSync(fullPath, "utf8");
  const mod = new Module(fullPath, module);
  mod.filename = fullPath;
  mod.paths = Module._nodeModulePaths(path.dirname(fullPath));
  const origRequire = mod.require.bind(mod);
  mod.require = (id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    return origRequire(id);
  };
  mod._compile(code, fullPath);
  return mod.exports;
}

test("default profile preserves root userData paths, zero-file footprint on read, and real User.name display", (t) => {
  const root = createTempRoot(t);
  const db = initMinimalProfileDb(root, { userName: "陈奕宏", applications: 18, resumes: 3 });
  db.close();
  fs.writeFileSync(path.join(root, ".secret"), "existing-root-secret");
  fs.writeFileSync(path.join(root, "uploads", "my-resume.pdf"), "pdf-bytes");

  const state = readProfilesState(root);
  assert.equal(state.activeProfileId, DEFAULT_PROFILE_ID);
  assert.equal(state.profiles.length, 1);
  assert.equal(fs.existsSync(path.join(root, "profiles.json")), false, "reading default state must not pollute userData");
  assert.equal(resolveProfileDataDir(root, "default"), root);
  assert.equal(browserPartitionForProfile("default"), "persist:job-application-browser");

  const detailed = listProfilesDetailed(root);
  assert.equal(detailed.activeProfileId, "default");
  assert.equal(detailed.profiles[0].isDefault, true);
  assert.equal(detailed.profiles[0].userRealName, "陈奕宏");
  assert.equal(detailed.profiles[0].displayName, "我的档案 (陈奕宏)");
  assert.equal(detailed.profiles[0].applicationCount, 18);
  assert.equal(detailed.profiles[0].resumeCount, 3);
});

test("profiles.json CRUD, active switching, default deletion guard, and path traversal rejection", (t) => {
  const root = createTempRoot(t);
  const mainDb = initMinimalProfileDb(root, { userName: "我" });
  mainDb.close();

  const partner = createProfile(root, { name: "  对象  ", color: "rose" });
  assert.match(partner.id, /^p-[a-f0-9]{12}$/);
  assert.equal(partner.name, "对象");
  assert.equal(partner.color, "rose");
  assert.equal(partner.isDefault, false);
  assert.equal(partner.dataDir, path.join(root, "profiles", partner.id));
  assert.equal(partner.browserPartition, `persist:job-application-browser-${partner.id}`);
  assert.equal(fs.existsSync(path.join(partner.dataDir, "uploads")), true);
  assert.equal(fs.existsSync(path.join(partner.dataDir, ".secret")), true);
  assert.equal(fs.existsSync(path.join(root, "profiles.json")), true);

  setActiveProfile(root, partner.id);
  assert.equal(readProfilesState(root).activeProfileId, partner.id);

  renameProfile(root, partner.id, "对象 · 小雨");
  assert.equal(listProfilesDetailed(root).profiles.find((p) => p.id === partner.id).name, "对象 · 小雨");

  // Default profile cannot be deleted
  assert.throws(() => deleteProfile(root, "default"), /默认主档案不可删除/);

  // Malicious profile IDs are strictly rejected everywhere
  for (const badId of ["", "../escape", "a/b", "a\\b", "UPPERCASE", "-leading", "p", "a".repeat(60)]) {
    assert.equal(isValidProfileId(badId), false, badId);
    assert.throws(() => resolveProfileDataDir(root, badId));
    assert.throws(() => browserPartitionForProfile(badId));
  }

  // Deleting the active secondary profile cleans up disk + backups and falls back to default
  fs.mkdirSync(`${partner.dataDir}-backups`, { recursive: true });
  fs.writeFileSync(path.join(`${partner.dataDir}-backups`, "snap.json"), "{}");
  const removed = deleteProfile(root, partner.id);
  assert.equal(removed.switchedToDefault, true);
  assert.equal(removed.activeProfileId, "default");
  assert.equal(removed.partitionToClear, `persist:job-application-browser-${partner.id}`);
  assert.equal(fs.existsSync(partner.dataDir), false);
  assert.equal(fs.existsSync(`${partner.dataDir}-backups`), false);
});

test("cross-profile AI Key sync decrypts with source .secret and re-encrypts with target .secret compatibly with src/lib/crypto.ts", (t) => {
  const root = createTempRoot(t);
  const mainSecret = ensureProfileSecret(root);
  const mainCrypto = loadCryptoTs(mainSecret);

  const mainDb = initMinimalProfileDb(root, { userName: "陈奕宏" });
  mainDb
    .prepare('UPDATE "User" SET "defaultAiProvider" = ?, "agentAiProvider" = ?, "agentAiModel" = ? WHERE "id" = ?')
    .run("deepseek", "gemini", "gemini-2.5-pro", "local-user");

  const encGemini = mainCrypto.encryptSecret("AIzaSy-test-gemini-key-123456");
  const encDeepseek = mainCrypto.encryptSecret("sk-deepseek-shared-key-987654");
  const now = new Date().toISOString();
  mainDb
    .prepare('INSERT INTO "AiKey" ("id", "userId", "provider", "apiKeyEncrypted", "model", "baseUrl", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run("k1", "local-user", "gemini", encGemini, "gemini-2.5-flash", null, now, now);
  mainDb
    .prepare('INSERT INTO "AiKey" ("id", "userId", "provider", "apiKeyEncrypted", "model", "baseUrl", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run("k2", "local-user", "deepseek", encDeepseek, "deepseek-chat", "https://api.deepseek.com/v1", now, now);
  mainDb.close();

  // Create partner profile with an empty migrated schema (even before User row exists!)
  const partner = createProfile(root, { name: "对象" });
  const partnerSecret = ensureProfileSecret(partner.dataDir);
  assert.notEqual(partnerSecret, mainSecret, "each profile must have its own independent .secret");

  const partnerDbInit = initMinimalProfileDb(partner.dataDir, { userName: null });
  partnerDbInit.close();

  const syncRes = syncAiKeysForProfile(root, partner.id);
  assert.equal(syncRes.ok, true);
  assert.equal(syncRes.synced, 2);
  assert.equal(syncRes.sourceProfileId, "default");
  assert.deepEqual(syncRes.providers.sort(), ["deepseek", "gemini"]);

  // Verify partner DB ciphertexts are re-encrypted under partnerSecret and readable by src/lib/crypto.ts!
  const partnerCrypto = loadCryptoTs(partnerSecret);
  const verifyDb = new DatabaseSync(path.join(partner.dataDir, "local.db"), { readOnly: true });
  try {
    const keys = verifyDb.prepare('SELECT "provider", "apiKeyEncrypted", "model", "baseUrl" FROM "AiKey" ORDER BY "provider"').all();
    assert.equal(keys.length, 2);

    const dsRow = keys.find((r) => r.provider === "deepseek");
    const gmRow = keys.find((r) => r.provider === "gemini");
    assert.notEqual(dsRow.apiKeyEncrypted, encDeepseek);
    assert.notEqual(gmRow.apiKeyEncrypted, encGemini);
    assert.throws(() => mainCrypto.decryptSecret(dsRow.apiKeyEncrypted), "must not be decryptable with main secret");

    assert.equal(partnerCrypto.decryptSecret(dsRow.apiKeyEncrypted), "sk-deepseek-shared-key-987654");
    assert.equal(dsRow.model, "deepseek-chat");
    assert.equal(dsRow.baseUrl, "https://api.deepseek.com/v1");
    assert.equal(partnerCrypto.decryptSecret(gmRow.apiKeyEncrypted), "AIzaSy-test-gemini-key-123456");
    assert.equal(gmRow.model, "gemini-2.5-flash");

    const userRow = verifyDb.prepare('SELECT "defaultAiProvider", "agentAiProvider", "agentAiModel" FROM "User" WHERE "id" = ?').get("local-user");
    assert.equal(userRow.defaultAiProvider, "deepseek");
    assert.equal(userRow.agentAiProvider, "gemini");
    assert.equal(userRow.agentAiModel, "gemini-2.5-pro");
  } finally {
    verifyDb.close();
  }

  // Subsequent automatic sync (overwrite=false) skips already-configured providers
  const secondSync = syncAiKeysForProfile(root, partner.id, { overwrite: false });
  assert.equal(secondSync.synced, 0);
  assert.equal(secondSync.skipped, 2);

  // Rotate key in main profile and run manual overwrite sync
  const rotatedEncrypted = encryptAiKeyWithSecret("sk-deepseek-rotated-2026", mainSecret);
  const mainDbWrite = new DatabaseSync(path.join(root, "local.db"));
  mainDbWrite.prepare('UPDATE "AiKey" SET "apiKeyEncrypted" = ? WHERE "provider" = ?').run(rotatedEncrypted, "deepseek");
  mainDbWrite.close();

  const manualSync = syncAiKeysForProfile(root, partner.id, { overwrite: true });
  assert.equal(manualSync.synced, 2);
  const afterRotateDb = new DatabaseSync(path.join(partner.dataDir, "local.db"), { readOnly: true });
  try {
    const dsAfter = afterRotateDb.prepare('SELECT "apiKeyEncrypted" FROM "AiKey" WHERE "provider" = ?').get("deepseek");
    assert.equal(decryptAiKeyWithSecret(dsAfter.apiKeyEncrypted, partnerSecret), "sk-deepseek-rotated-2026");
  } finally {
    afterRotateDb.close();
  }
});

test("browser-view and render-bridge isolate Chromium partitions, history, and saved logins per profile", async (t) => {
  const root = createTempRoot(t);
  ensureProfileSecret(root);
  const partner = createProfile(root, { name: "对象" });

  assert.equal(isAllowedBrowserPartition(DEFAULT_BROWSER_PARTITION), true);
  assert.equal(isAllowedBrowserPartition(`persist:job-application-browser-${partner.id}`), true);
  assert.equal(isAllowedBrowserPartition("persist:job-application-browser-default"), false);
  assert.equal(isAllowedBrowserPartition("persist:arbitrary-session"), false);

  const partitionsRequested = [];
  const closedTabs = [];
  const handlers = new Map();
  let tabCounter = 0;

  const makeFakeWebContents = (label) => {
    let currentUrl = "about:blank";
    let closed = false;
    const mainFrame = { url: "about:blank", executeJavaScript: async () => null, framesInSubtree: [] };
    mainFrame.framesInSubtree = [mainFrame];
    return {
      id: ++tabCounter,
      mainFrame,
      getURL: () => currentUrl,
      getTitle: () => label,
      isLoading: () => false,
      isDestroyed: () => closed,
      getZoomFactor: () => 1,
      setZoomFactor: () => {},
      setWindowOpenHandler: () => {},
      loadURL: (u) => { currentUrl = u; mainFrame.url = u; },
      stop: () => {},
      reload: () => {},
      close: () => { closed = true; closedTabs.push(label); },
      on: () => {},
      once: () => {},
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
        getAllEntries: () => [{ url: currentUrl, title: label }],
        getActiveIndex: () => 0,
      },
    };
  };

  const viewPartitions = [];
  const fakeFrame = { url: "http://localhost:3210/browser" };
  const fakeWin = {
    isDestroyed: () => false,
    webContents: {
      id: 999,
      send: () => {},
      isDestroyed: () => false,
      getURL: () => "http://localhost:3210/browser",
      mainFrame: fakeFrame,
    },
    contentView: { addChildView: () => {}, removeChildView: () => {} },
  };
  const trustedEvent = { sender: fakeWin.webContents, senderFrame: fakeFrame };

  const bv = loadElectronModuleWithMocks("electron/browser-view.js", {
    electron: {
      app: { getPath: (kind) => (kind === "userData" ? root : path.join(root, kind)) },
      BrowserWindow: { getAllWindows: () => [] },
      session: {
        fromPartition: (name) => {
          partitionsRequested.push(name);
          return {
            partitionName: name,
            on: () => {},
            clearStorageData: async () => {},
            clearCache: async () => {},
          };
        },
      },
      ipcMain: {
        handle: (ch, fn) => handlers.set(ch, fn),
        on: () => {},
      },
      clipboard: { readText: () => "", writeText: () => {} },
      shell: { openExternal: async () => {}, showItemInFolder: () => {}, openPath: async () => "" },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      WebContentsView: function (opts) {
        viewPartitions.push(opts?.webPreferences?.session?.partitionName);
        return {
          webContents: makeFakeWebContents(`tab-${viewPartitions.length}`),
          setBounds: () => {},
          setBackgroundColor: () => {},
        };
      },
      Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    },
  });

  bv.setupBrowserViewIpc(fakeWin, 3210);
  assert.equal(bv.getActiveBrowserPartition(), "persist:job-application-browser");

  await handlers.get("browser:new-tab")(trustedEvent, "https://jobs.bytedance.com");
  assert.equal(viewPartitions[0], "persist:job-application-browser");

  // Switch embedded browser to partner profile
  const switched = bv.switchBrowserProfile({ profileId: partner.id, dataDir: partner.dataDir });
  assert.equal(switched.partition, `persist:job-application-browser-${partner.id}`);
  assert.equal(bv.getActiveBrowserPartition(), `persist:job-application-browser-${partner.id}`);
  assert.deepEqual(closedTabs, ["tab-1"], "outgoing profile tabs must be closed on switch");

  await handlers.get("browser:new-tab")(trustedEvent, "https://join.qq.com");
  assert.equal(viewPartitions[1], `persist:job-application-browser-${partner.id}`);
});

test("native menu / tray profileSwitchMenuItems, preload bridge, and sidebar UI wiring are complete", () => {
  let switchedId = null;
  let createClicked = false;
  const profiles = [
    { id: "default", name: "我的档案", displayName: "我的档案 (陈奕宏)", isDefault: true },
    { id: "p-partner01", name: "对象", displayName: "对象", isDefault: false },
  ];
  const menu = profileSwitchMenuItems(profiles, "p-partner01", {
    onSwitch: (id) => { switchedId = id; },
    onCreateProfile: () => { createClicked = true; },
  });

  assert.equal(menu[0].label, "我的档案 (陈奕宏)");
  assert.equal(menu[0].checked, false);
  assert.equal(menu[1].label, "对象");
  assert.equal(menu[1].checked, true);

  // Clicking already-active profile is a no-op; clicking inactive switches
  menu[1].click();
  assert.equal(switchedId, null);
  menu[0].click();
  assert.equal(switchedId, "default");

  menu[menu.length - 1].click();
  assert.equal(createClicked, true);

  // Tray tooltip preserves default title and highlights secondary profile when active
  assert.equal(trayTooltip({ today: 0, items: [] }, profiles[0]), "求职罗盘");
  assert.equal(trayTooltip({ today: 0, items: [] }, profiles[1]), "求职罗盘 [对象]");

  // Verify preload, main, and sidebar wiring
  const preloadSrc = fs.readFileSync(path.resolve(__dirname, "../electron/preload.js"), "utf8");
  assert.match(preloadSrc, /exposeInMainWorld\("desktopProfiles"/);
  const mainSrc = fs.readFileSync(path.resolve(__dirname, "../electron/main.js"), "utf8");
  assert.match(mainSrc, /👥 切换求职人/);
  assert.match(mainSrc, /ipcMain\.handle\("profiles:switch"/);
  const navSrc = fs.readFileSync(path.resolve(__dirname, "../src/components/dashboard/nav.tsx"), "utf8");
  assert.match(navSrc, /<ProfileSwitcher/);
});
