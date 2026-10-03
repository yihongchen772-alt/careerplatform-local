// 求职罗盘 网申助手 — service worker. The form engine is the desktop app's own
// (lib/autofill-core.js, generated from electron/autofill-core.js by
// scripts/build-extension.cjs); this file only adapts it to Chrome's APIs and
// talks to the running 求职罗盘 App on localhost, where all data stays.
importScripts("lib/autofill-core.js");
const core = self.JobCompassCore;

const DEFAULT_BASE = "http://localhost:3210";
const drafts = new Map(); // tabId -> AI drafts filled there (for 记住本页)
const tasks = new Map();
const plans = new Map();
const running = new Set(); // tabIds with an autofill in progress
const remembering = new Set();

async function settings() {
  const stored = await chrome.storage.local.get(["token", "appBase", "resumeVersionId", "variantId", "expandBlocks", "fillModules", "positionId", "autoRemember"]);
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

async function adapterFor(tabId, task) {
  await loadDrafts(tabId);
  const tab = await chrome.tabs.get(tabId);
  const boundJob = (await chrome.storage.session.get(`job:${tabId}`))[`job:${tabId}`];
  let liveUrl = tab.url;
  const onUpdated = (id, info) => {
    if (id !== tabId) return;
    if (info.url) liveUrl = info.url;
    if (task && (info.url || info.status === "loading")) cancelFill(tabId, "页面已变化，填写已停止");
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  return {
    dispose: () => chrome.tabs.onUpdated.removeListener(onUpdated),
    adapter: {
      url: () => liveUrl,
      stillOnPage: (initialUrl) => liveUrl === initialUrl && !task?.controller.signal.aborted,
      taskId: task?.id,
      stopReason: () => task?.reason,
      frames: () => tabFrames(tabId),
      run: (frameId, fn, args) => runInFrame(tabId, frameId, fn, args),
      api: (name, init) => api(name, { ...init, signal: task?.controller.signal }),
      status: (payload) => broadcast(tabId, payload),
      uploadResume: async (resumeVersionId) => {
        const initialUrl = liveUrl;
        let candidates = 0;
        const frames = await tabFrames(tabId);
        for (const frameId of frames) candidates += (await runInFrame(tabId, frameId, core.markResumeFileInputs).catch(() => 0)) || 0;
        if (!candidates) return 0;
        const res = await api(`resume-file?resumeVersionId=${encodeURIComponent(resumeVersionId)}`, { signal: task?.controller.signal });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "简历附件上传失败");
        const filename = decodeURIComponent(res.headers.get("x-file-name") || "resume.pdf");
        const base64 = bytesToBase64(await res.arrayBuffer());
        let attached = 0;
        for (const frameId of frames) {
          if (liveUrl !== initialUrl || task?.controller.signal.aborted) throw new Error("页面已切换，已停止上传简历");
          attached += (await runInFrame(tabId, frameId, core.attachResumeFile, [base64, filename, res.headers.get("content-type")]).catch(() => 0)) || 0;
        }
        return attached;
      },
      jobId: () => task?.positionId ?? boundJob,
      archiveScope: () => (task?.positionId ?? boundJob) ? `job:v1:${task?.positionId ?? boundJob}` : core.portalContext(liveUrl),
      getPlan: () => plans.get(tabId),
      setPlan: async (plan) => { if (plan) { plans.set(tabId, plan); await chrome.storage.session.set({ [`plan:${tabId}`]: { ...plan, frameById: [...plan.frameById] } }); } else { plans.delete(tabId); await chrome.storage.session.remove(`plan:${tabId}`); } },
      getDrafts: () => drafts.get(tabId) || [],
      setDrafts: (list) => storeDrafts(tabId, list),
    },
  };
}

async function fillTab(tabId, options) {
  if (running.has(tabId)) return { phase: "error", message: "这页正在填写中" };
  running.add(tabId);
  const stop = keepAlive();
  const task = { id: crypto.randomUUID(), controller: new AbortController(), reason: null };
  tasks.set(tabId, task);
  let dispose = () => {};
  const onNavigation = (id, info) => {
    if (id === tabId && (info.url || info.status === "loading")) cancelFill(tabId, "页面已变化，填写已停止");
  };
  chrome.tabs.onUpdated.addListener(onNavigation);
  try {
    const ready = await adapterFor(tabId, task);
    dispose = ready.dispose;
    const adapter = ready.adapter;
    for (const frameId of await tabFrames(tabId)) await runInFrame(tabId, frameId, (id) => document.documentElement.setAttribute("data-cp-task", id), [task.id]).catch(() => {});
    const prefs = await settings();
    const session = await chrome.storage.session.get([`plan:${tabId}`, `job:${tabId}`, `archive:${tabId}`]);
    if (!plans.has(tabId) && session[`plan:${tabId}`]) { const plan = session[`plan:${tabId}`]; plans.set(tabId, { ...plan, frameById: new Map(plan.frameById) }); }
    const resumeVersionId = options.resumeVersionId ?? prefs.resumeVersionId ?? undefined;
    task.positionId = options.positionId ?? session[`job:${tabId}`];
    if (options.mode === "apply") return await core.applyAutofillPlan(adapter, options);
    await chrome.storage.session.set({ [`archive:${tabId}`]: { resumeVersionId: resumeVersionId || undefined, variantId: options.variantId ?? prefs.variantId, positionId: task.positionId, contextKey: task.positionId ? `job:v1:${task.positionId}` : core.portalContext(adapter.url()) } });
    return await core.runAutofillCore(adapter, resumeVersionId || undefined, {
      mode: options.mode, questionIds: options.questionIds, previewEdits: options.previewEdits, positionId: task.positionId, regenerate: options.regenerate, answerLength: options.answerLength,
      variantId: options.variantId ?? prefs.variantId ?? undefined,
      expandBlocks: options.expandBlocks ?? !!prefs.expandBlocks,
      modules: options.modules ?? prefs.fillModules,
    });
  } catch (err) {
    const status = { phase: "error", message: task.reason || err.message || "填写失败" };
    broadcast(tabId, status);
    return status;
  } finally {
    dispose();
    chrome.tabs.onUpdated.removeListener(onNavigation);
    stop();
    running.delete(tabId);
    tasks.delete(tabId);
  }
}

function cancelFill(tabId, reason = "已停止填写，已填入的内容保留") {
  const task = tasks.get(tabId);
  if (!task || task.controller.signal.aborted) return;
  task.reason = reason;
  task.controller.abort();
  tabFrames(tabId).then((frames) => Promise.all(frames.map((frameId) => runInFrame(tabId, frameId, () => document.documentElement.removeAttribute("data-cp-task")).catch(() => {})))).catch(() => {});
}

async function saveTab(tabId, onlyUserEdited = false) {
  if (remembering.has(tabId) || running.has(tabId)) return { saved: 0 };
  remembering.add(tabId);
  let dispose;
  try {
    const context = await adapterFor(tabId); dispose = context.dispose;
    const { resumeVersionId } = await settings();
    return await core.saveCorrectionsCore(context.adapter, resumeVersionId || undefined, onlyUserEdited);
  } finally {
    dispose?.(); remembering.delete(tabId);
  }
}

// This listener lives in Chrome's isolated world. It only requests a reread
// by our engine; the website cannot send personal data into the library.
function installMemoryWatcher(enabled) {
  window.__cpAutoMemoryEnabled = enabled;
  if (window.__cpAutoMemoryInstalled) return;
  window.__cpAutoMemoryInstalled = true;
  let timer;
  const queue = (event) => {
    if (!window.__cpAutoMemoryEnabled || !event.isTrusted) return;
    if (!event.target?.closest?.("input, textarea, select, .ant-select, .el-select, [role='option'], [role='combobox']")) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (window.__cpAutoMemoryEnabled) chrome.runtime.sendMessage({ type: "auto-memory", url: location.href }).catch(() => {});
    }, 2800);
  };
  for (const event of ["input", "change", "focusout", "click"]) document.addEventListener(event, queue, true);
}

async function watchMemory(tabId, enabled) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || "")) return { enabled: false };
  const origin = new URL(tab.url).origin;
  await chrome.storage.session.set({ [`memory:${tabId}`]: { enabled, origin } });
  const { adapter, dispose } = await adapterFor(tabId);
  try {
    // Register field ids and tracking before the first handwritten value,
    // including pages where the applicant never clicks Autofill.
    await core.scanFrames(adapter);
    for (const frame of await tabFrames(tabId)) await runInFrame(tabId, frame, installMemoryWatcher, [enabled]).catch(() => {});
  } finally { dispose(); }
  return { enabled };
}

async function rememberAutomatically(sender, message) {
  const tabId = sender.tab.id;
  const state = (await chrome.storage.session.get(`memory:${tabId}`))[`memory:${tabId}`];
  const tab = await chrome.tabs.get(tabId);
  if (!state?.enabled || new URL(tab.url).origin !== state.origin || sender.url !== message.url) return { saved: 0 };
  try {
    const result = await saveTab(tabId, true);
    if (result.pending) {
      const status = { pending: result.pending, at: Date.now() };
      await chrome.storage.session.set({ [`memory-status:${tabId}`]: status });
      chrome.runtime.sendMessage({ type: "memory-status", tabId, status }).catch(() => {});
    }
    return result;
  } catch (error) {
    const status = { error: error.message, at: Date.now() };
    await chrome.storage.session.set({ [`memory-status:${tabId}`]: status });
    chrome.runtime.sendMessage({ type: "memory-status", tabId, status }).catch(() => {});
    throw error;
  }
}

async function pageInfo(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const text = (await runInFrame(tabId, 0, core.capturePageText).catch(() => "")) || "";
  const success = await runInFrame(tabId, 0, core.detectApplicationSuccess).catch(() => null);
  return { url: tab.url || "", title: tab.title || "", text, success };
}

const handlers = {
  async watchMemory({ tabId, enabled }) { return watchMemory(tabId, enabled === true); },
  async memoryStatus({ tabId }) { return (await chrome.storage.session.get(`memory-status:${tabId}`))[`memory-status:${tabId}`] || null; },
  async saveDraft({ draft }) { return jsonOrThrow(await api("application-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) })); },
  async context({ tabId }) { const data = await jsonOrThrow(await api("application-context")); const session = await chrome.storage.session.get(`job:${tabId}`); return { ...data, positionId: session[`job:${tabId}`] || "" }; },
  async bind({ tabId, positionId }) { await chrome.storage.session.set({ [`job:${tabId}`]: positionId || "" }); plans.delete(tabId); await chrome.storage.session.remove(`plan:${tabId}`); },
  async profile({ resumeVersionId, variantId }) { return jsonOrThrow(await api(`profile?${new URLSearchParams({ resumeVersionId: resumeVersionId || "", variantId: variantId || "" })}`)); },
  async focus({ tabId, id }) { for (const frame of await tabFrames(tabId)) if (await runInFrame(tabId, frame, core.focusFormField, [id]).catch(() => false)) break; },
  async sidepanel({ tabId }) { await chrome.sidePanel.open({ tabId }); },
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
  async cancel({ tabId }) { cancelFill(tabId); return { stopped: true }; },
  async save({ tabId }) {
    return saveTab(tabId);
  },
  async capture({ tabId }) {
    const page = await pageInfo(tabId);
    return jsonOrThrow(await api("capture-job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: page.url, title: page.title, text: page.text }) }));
  },
  async record({ tabId, companyName, title, applyUrl, resumeVersionId }) {
    const prefs = await settings();
    const session = await chrome.storage.session.get([`job:${tabId}`, `archive:${tabId}`]);
    const archive = session[`archive:${tabId}`] || {};
    const positionId = session[`job:${tabId}`] || undefined;
    const fields = [];
    for (const frame of await tabFrames(tabId)) {
      await runInFrame(tabId, frame, core.readCurrentApplicationFields).catch(() => {});
      fields.push(...((await runInFrame(tabId, frame, core.collectApplicationFields, [archive.contextKey || (positionId ? `job:v1:${positionId}` : core.portalContext(applyUrl))]).catch(() => [])) || []));
    }
    return jsonOrThrow(await api("record-application", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName, title, applyUrl, appliedDate: new Date().toISOString(), resumeVersionId, positionId, snapshot: { fields, url: applyUrl, resumeVersionId: archive.resumeVersionId || resumeVersionId, variantId: archive.variantId || prefs.variantId, positionId: archive.positionId || positionId } }) }));
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
  if (sender.id === chrome.runtime.id && sender.tab?.id && /^https?:/.test(sender.url || "") && message?.type === "auto-memory") {
    rememberAutomatically(sender, message).then((data) => sendResponse({ ok: true, data })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  // All other operations are restricted to our own extension UI.
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

chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId }) => { plans.delete(tabId); chrome.storage.session.remove(`plan:${tabId}`).catch(() => {}); cancelFill(tabId, "页面已变化，填写已停止"); });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url || info.status === "loading") { plans.delete(tabId); chrome.storage.session.remove(`plan:${tabId}`).catch(() => {}); }
  if (info.status === "complete") chrome.storage.session.get(`memory:${tabId}`).then(async (stored) => {
    const state = stored[`memory:${tabId}`]; if (!state?.enabled) return;
    const tab = await chrome.tabs.get(tabId);
    if (/^https?:/.test(tab.url || "") && new URL(tab.url).origin === state.origin) await watchMemory(tabId, true);
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  cancelFill(tabId, "标签页已关闭，填写已停止");
  drafts.delete(tabId);
  plans.delete(tabId);
  chrome.storage.session.remove([`status:${tabId}`, `drafts:${tabId}`, `plan:${tabId}`, `job:${tabId}`, `archive:${tabId}`, `memory:${tabId}`, `memory-status:${tabId}`]).catch(() => {});
});
