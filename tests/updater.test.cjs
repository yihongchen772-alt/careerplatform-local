const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { setupUpdater, CHANNELS, RELEASES_URL } = require("../electron/updater");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  const handlers = new Map();
  const events = [];
  const opened = [];
  const installs = [];
  const updater = new EventEmitter();
  const calls = { check: 0, download: 0, backup: 0 };
  const url = "http://localhost:3210/settings";
  const contents = {
    mainFrame: { url },
    getURL: () => url,
    isDestroyed: () => false,
    send: (channel, state) => events.push({ channel, state }),
  };
  const window = { webContents: contents, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  updater.checkForUpdates = async () => { calls.check++; updater.emit("update-available", { version: "0.9.0" }); };
  updater.downloadUpdate = async () => { calls.download++; updater.emit("update-downloaded", { version: "0.9.0" }); };
  updater.quitAndInstall = (...args) => { installs.push(args); };
  const controller = setupUpdater({
    app: { isPackaged: options.isPackaged ?? true, getVersion: () => "0.8.0" },
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: (channel) => handlers.delete(channel) },
    getMainWindow: () => window,
    beforeInstall: options.beforeInstall ?? (async () => { calls.backup++; }),
  }, {
    platform: options.platform ?? "win32",
    arch: options.arch ?? "x64",
    autoUpdater: updater,
    openExternal: async (url) => { opened.push(url); },
  });
  const invoke = (channel, source = event, ...args) => handlers.get(channel)(source, ...args);
  return { updater, controller, handlers, events, event, window, contents, calls, installs, opened, invoke };
}

test("updates do nothing until requested and never install on normal quit", async () => {
  const f = fixture();
  assert.equal(f.controller.getState().status, "idle");
  assert.deepEqual(f.calls, { check: 0, download: 0, backup: 0 });
  assert.equal(f.updater.autoDownload, false);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowPrerelease, false);
  assert.equal(f.updater.allowDowngrade, false);
  await f.invoke(CHANNELS.check);
  assert.equal(f.controller.getState().status, "available");
  assert.equal(f.calls.download, 0);
  assert.equal(f.installs.length, 0);
});

test("every IPC rejects another webContents and child frames, including read and release actions", async () => {
  const f = fixture();
  const impostor = { ...f.contents };
  for (const channel of f.handlers.keys()) {
    await assert.rejects(f.invoke(channel, { sender: impostor, senderFrame: impostor.mainFrame }), /主窗口/);
    await assert.rejects(f.invoke(channel, { sender: f.contents, senderFrame: { url: f.contents.mainFrame.url } }), /不受信任/);
    await assert.rejects(f.invoke(channel, { sender: f.contents }), /不受信任/);
  }
  assert.equal(f.calls.check, 0);
  assert.equal(f.opened.length, 0);
});

test("main-frame navigation to untrusted host or port loses update privileges", async () => {
  const f = fixture();
  for (const url of ["https://github.com", "http://localhost:3210.evil.test", "http://localhost:3000", "file:///tmp/index.html"]) {
    f.contents.mainFrame.url = url;
    f.contents.getURL = () => url;
    await assert.rejects(f.invoke(CHANNELS.install), /不受信任/);
  }
});

test("release page uses the fixed repository URL and ignores supplied URLs", async () => {
  const f = fixture();
  await f.invoke(CHANNELS.releases, f.event, "file:///malicious.exe");
  assert.deepEqual(f.opened, [RELEASES_URL]);
});

test("download and install require the preceding successful stages", async () => {
  const f = fixture();
  await f.invoke(CHANNELS.download);
  await f.invoke(CHANNELS.install);
  assert.equal(f.calls.download, 0);
  assert.equal(f.calls.backup, 0);
  await f.invoke(CHANNELS.check);
  await f.invoke(CHANNELS.install);
  assert.equal(f.installs.length, 0);
  await f.invoke(CHANNELS.download);
  assert.equal(f.controller.getState().status, "downloaded");
  assert.equal(f.installs.length, 0);
  await f.invoke(CHANNELS.install);
  assert.equal(f.calls.backup, 1);
  assert.deepEqual(f.installs, [[true, true]]);
});

test("duplicate requests cannot overlap checks or start a download during a check", async () => {
  const f = fixture();
  const pending = deferred();
  f.updater.checkForUpdates = async () => {
    f.calls.check++;
    f.updater.emit("update-available", { version: "0.9.0" });
    await pending.promise;
  };
  const checking = f.invoke(CHANNELS.check);
  await f.invoke(CHANNELS.check);
  await f.invoke(CHANNELS.download);
  assert.equal(f.calls.check, 1);
  assert.equal(f.calls.download, 0);
  pending.resolve();
  await checking;
  await f.invoke(CHANNELS.download);
  assert.equal(f.calls.download, 1);
});

test("check failure is retryable without exposing error details", async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => { throw new Error("private-path-and-token"); };
  let state = await f.invoke(CHANNELS.check);
  assert.equal(state.errorStage, "check");
  assert.doesNotMatch(JSON.stringify(state), /private-path-and-token/);
  f.updater.checkForUpdates = async () => f.updater.emit("update-not-available", { version: "0.8.0" });
  state = await f.invoke(CHANNELS.check);
  assert.equal(state.status, "not-available");
  assert.equal(state.errorStage, null);
});

test("a failed download can retry the same version and cannot install partial files", async () => {
  const f = fixture();
  await f.invoke(CHANNELS.check);
  f.updater.downloadUpdate = async () => {
    f.updater.emit("error", new Error("checksum mismatch"));
    throw new Error("checksum mismatch");
  };
  let state = await f.invoke(CHANNELS.download);
  assert.equal(state.errorStage, "download");
  assert.equal(state.availableVersion, "0.9.0");
  await f.invoke(CHANNELS.install);
  assert.equal(f.installs.length, 0);
  f.updater.downloadUpdate = async () => f.updater.emit("update-downloaded", { version: "0.9.0" });
  state = await f.invoke(CHANNELS.download);
  assert.equal(state.status, "downloaded");
});

test("cancelled download can retry and an unexpected downloaded event never authorizes installation", async () => {
  const f = fixture();
  f.updater.emit("update-downloaded", { version: "0.9.0" });
  await f.invoke(CHANNELS.install);
  assert.equal(f.installs.length, 0);
  await f.invoke(CHANNELS.check);
  f.updater.downloadUpdate = async () => f.updater.emit("update-cancelled");
  assert.equal((await f.invoke(CHANNELS.download)).errorStage, "download");
  f.updater.downloadUpdate = async () => f.updater.emit("update-downloaded", { version: "0.9.0" });
  assert.equal((await f.invoke(CHANNELS.download)).status, "downloaded");
});

test("install waits for async backup and duplicate install does not run the hook twice", async () => {
  const pending = deferred();
  let backups = 0;
  const f = fixture({ beforeInstall: async () => { backups++; await pending.promise; } });
  await f.invoke(CHANNELS.check);
  await f.invoke(CHANNELS.download);
  const installing = f.invoke(CHANNELS.install);
  await f.invoke(CHANNELS.install);
  await f.invoke(CHANNELS.check);
  assert.equal(backups, 1);
  assert.equal(f.installs.length, 0);
  assert.equal(f.calls.check, 1);
  pending.resolve();
  await installing;
  assert.equal(f.installs.length, 1);
});

test("failed backup prevents quitting, and the already downloaded installer can be retried", async () => {
  let attempts = 0;
  const f = fixture({ beforeInstall: async () => { if (++attempts === 1) throw new Error("disk full"); } });
  await f.invoke(CHANNELS.check);
  await f.invoke(CHANNELS.download);
  assert.equal((await f.invoke(CHANNELS.install)).errorStage, "install");
  assert.equal(f.installs.length, 0);
  assert.equal((await f.invoke(CHANNELS.install)).status, "installing");
  assert.equal(f.installs.length, 1);
  assert.equal(f.calls.download, 1);
});

test("progress is bounded, only received while downloading, and snapshot values are isolated", async () => {
  const f = fixture();
  await f.invoke(CHANNELS.check);
  const pending = deferred();
  f.updater.downloadUpdate = () => pending.promise;
  const downloading = f.invoke(CHANNELS.download);
  f.updater.emit("download-progress", { percent: 140, total: Infinity, transferred: -5, bytesPerSecond: NaN });
  const state = f.controller.getState();
  assert.deepEqual(state.progress, { percent: 100, total: 0, transferred: 0, bytesPerSecond: 0 });
  state.progress.percent = 1;
  assert.equal(f.controller.getState().progress.percent, 100);
  f.updater.emit("update-downloaded", { version: "0.9.0" });
  pending.resolve();
  await downloading;
  f.updater.emit("download-progress", { percent: 0 });
  assert.equal(f.controller.getState().status, "downloaded");
  assert.equal(f.controller.getState().progress, null);
  assert.ok(f.events.every(({ channel }) => channel === CHANNELS.changed));
});

test("Mac, development, and other architectures offer release downloads without running updater", async () => {
  for (const options of [{ platform: "darwin", arch: "arm64" }, { isPackaged: false }, { arch: "arm64" }]) {
    const f = fixture(options);
    for (const channel of [CHANNELS.check, CHANNELS.download, CHANNELS.install]) await f.invoke(channel);
    assert.equal(f.controller.getState().status, "unsupported");
    assert.deepEqual(f.calls, { check: 0, download: 0, backup: 0 });
    assert.equal(f.updater.listenerCount("update-available"), 0);
    await f.invoke(CHANNELS.releases);
    assert.deepEqual(f.opened, [RELEASES_URL]);
  }
});

test("dispose unregisters IPC and updater events", () => {
  const f = fixture();
  f.controller.dispose();
  assert.equal(f.handlers.size, 0);
  assert.equal(f.updater.listenerCount("update-downloaded"), 0);
});
