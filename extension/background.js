// 求职罗盘 网申助手 — service worker. The form engine is the desktop app's own
// (lib/autofill-core.js, generated from electron/autofill-core.js by
// scripts/build-extension.cjs); this file only adapts it to Chrome's APIs and
// talks to the running 求职罗盘 App on localhost, where all data stays.
importScripts("lib/autofill-core.js");
const core = self.JobCompassCore;

const DEFAULT_BASE = "http://localhost:3210";
const drafts = new Map(); // tabId -> AI drafts filled there (for 记住本页)
const running = new Set(); // tabIds with an autofill in progress

async function settings() {
  const stored = await chrome.storage.local.get(["token", "appBase", "resumeVersionId", "variantId", "expandBlocks"]);
  return { base: stored.appBase || DEFAULT_BASE, ...stored };
}

async function api(path, init = {}) {
  const { base, token } = await settings();
  if (!token) {
    const error = new Error("还没配对：在求职罗盘 App 的账号设置 → 浏览器插件里生成配对码，填到插件里");
    error.code = "unpaired";
    throw error;
  }
  let res;
  try {
    res = await fetch(`${base}/api/extension/${path}`, { ...init, headers: { ...(init.headers || {}), "x-jobcompass-token": token } });
  } catch {
    const error = new Error("连不上求职罗盘 App：请先打开 App（插件的数据都来自它）");
    error.code = "offline";
    throw error;
  }
  if (res.status === 401) {
    const error = new Error((await res.json().catch(() => ({}))).error || "配对码无效，请重新填写");
    error.code = "unpaired";
    throw error;
  }
  return res;
}

async function jsonOrThrow(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `求职罗盘返回错误（${res.status}）`);
  return body;
}

async function runInFrame(tabId, frameId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args });
  return result ? result.result : undefined;
}

async function tabFrames(tabId) {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
  return frames
    .filter((frame) => !frame.errorOccurred && /^https?:|^about:blank|^about:srcdoc/.test(frame.url))
    .sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : 0))
    .map((frame) => frame.frameId);
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function broadcast(tabId, status) {
  chrome.storage.session.set({ [`status:${tabId}`]: { ...status, at: Date.now() } }).catch(() => {});
  chrome.runtime.sendMessage({ type: "status", tabId, status }).catch(() => {});
  runInFrame(tabId, 0, core.showPageStatus, [status]).catch(() => {});
}

// Chrome's API calls keep a service worker alive; a 60s AI request alone might not.
function keepAlive() {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  return () => clearInterval(timer);
}

// Drafts also go to session storage: Chrome suspends an idle worker, and the
// in-memory map would be empty by the time 记住本页 is pressed.
async function loadDrafts(tabId) {
  if (!drafts.has(tabId)) {
    const key = `drafts:${tabId}`;
    drafts.set(tabId, (await chrome.storage.session.get(key))[key] || []);
  }
}

function storeDrafts(tabId, list) {
  drafts.set(tabId, list);
  chrome.storage.session.set({ [`drafts:${tabId}`]: list }).catch(() => {});
}

async function adapterFor(tabId) {
  await loadDrafts(tabId);
  const tab = await chrome.tabs.get(tabId);
  let liveUrl = tab.url;
  const onUpdated = (id, info) => {
    if (id === tabId && info.url) liveUrl = info.url;
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  return {
    dispose: () => chrome.tabs.onUpdated.removeListener(onUpdated),
    adapter: {
      url: () => liveUrl,
      stillOnPage: (initialUrl) => liveUrl === initialUrl,
      frames: () => tabFrames(tabId),
      run: (frameId, fn, args) => runInFrame(tabId, frameId, fn, args),
      api: (name, init) => api(name, init),
      status: (payload) => broadcast(tabId, payload),
      uploadResume: async (resumeVersionId) => {
        let candidates = 0;
        const frames = await tabFrames(tabId);
        for (const frameId of frames) candidates += (await runInFrame(tabId, frameId, core.markResumeFileInputs).catch(() => 0)) || 0;
        if (!candidates) return 0;
        const res = await api(`resume-file?resumeVersionId=${encodeURIComponent(resumeVersionId)}`);
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "简历附件上传失败");
        const filename = decodeURIComponent(res.headers.get("x-file-name") || "resume.pdf");
        const base64 = bytesToBase64(await res.arrayBuffer());
        let attached = 0;
        for (const frameId of frames) {
          attached += (await runInFrame(tabId, frameId, core.attachResumeFile, [base64, filename, res.headers.get("content-type")]).catch(() => 0)) || 0;
        }
        return attached;
      },
      getDrafts: () => drafts.get(tabId) || [],
      setDrafts: (list) => storeDrafts(tabId, list),
    },
  };
}

async function fillTab(tabId, options) {
  if (running.has(tabId)) return { phase: "error", message: "这页正在填写中" };
  running.add(tabId);
  const stop = keepAlive();
  const { adapter, dispose } = await adapterFor(tabId);
  try {
    const prefs = await settings();
    const resumeVersionId = options.resumeVersionId ?? prefs.resumeVersionId ?? undefined;
    return await core.runAutofillCore(adapter, resumeVersionId || undefined, {
      variantId: options.variantId ?? prefs.variantId ?? undefined,
      expandBlocks: options.expandBlocks ?? !!prefs.expandBlocks,
    });
  } catch (err) {
    const status = { phase: "error", message: err.message || "填写失败" };
    broadcast(tabId, status);
    return status;
  } finally {
    dispose();
    stop();
    running.delete(tabId);
  }
}

async function saveTab(tabId) {
  const { adapter, dispose } = await adapterFor(tabId);
  try {
    const { resumeVersionId } = await settings();
    return await core.saveCorrectionsCore(adapter, resumeVersionId || undefined, false);
  } finally {
    dispose();
  }
}

async function pageInfo(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const text = (await runInFrame(tabId, 0, core.capturePageText).catch(() => "")) || "";
  const success = await runInFrame(tabId, 0, core.detectApplicationSuccess).catch(() => null);
  return { url: tab.url || "", title: tab.title || "", text, success };
}

const handlers = {
  async status() {
    return jsonOrThrow(await api("status"));
  },
  async pair({ token, appBase }) {
    await chrome.storage.local.set({ token: token.trim(), ...(appBase ? { appBase } : {}) });
    return jsonOrThrow(await api("status"));
  },
  async site({ tabId }) {
    const page = await pageInfo(tabId);
    if (!/^https?:/.test(page.url)) return { page, match: null };
    const site = await jsonOrThrow(await api("site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: page.url, title: page.title, text: page.text.slice(0, 20000) }) }));
    return { page: { url: page.url, title: page.title, success: page.success }, ...site };
  },
  async fill({ tabId, ...options }) {
    // Fire and forget: the popup may close while the AI is still answering.
    fillTab(tabId, options);
    return { started: true };
  },
  async save({ tabId }) {
    return saveTab(tabId);
  },
  async capture({ tabId }) {
    const page = await pageInfo(tabId);
    return jsonOrThrow(await api("capture-job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: page.url, title: page.title, text: page.text }) }));
  },
  async record({ companyName, title, applyUrl, resumeVersionId }) {
    return jsonOrThrow(await api("record-application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName, title, applyUrl, resumeVersionId }) }));
  },
  async portal({ companyId, url }) {
    return jsonOrThrow(await api("portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, url }) }));
  },
  async lastStatus({ tabId }) {
    const key = `status:${tabId}`;
    return (await chrome.storage.session.get(key))[key] || null;
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the extension's own pages (the popup) talk to the worker; a web page
  // has no channel here — the extension injects functions, never listeners.
  if (sender.id !== chrome.runtime.id || !(sender.url || "").startsWith(chrome.runtime.getURL(""))) return false;
  const handler = handlers[message && message.type];
  if (!handler) return false;
  handler(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message || "出错了", code: err.code }));
  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "fill-page" || !tab || !tab.id) return;
  fillTab(tab.id, {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  drafts.delete(tabId);
  chrome.storage.session.remove([`status:${tabId}`, `drafts:${tabId}`]).catch(() => {});
});
