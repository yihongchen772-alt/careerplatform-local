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
  const stored = await chrome.storage.local.get(["token", "appBase", "resumeVersionId", "variantId", "expandBlocks", "saveBlocks", "fillModules", "fillModulesVersion", "positionId", "autoRemember", "autoRecord"]);
  // Saved before 校园经历 existed: on for whoever fills 实习/工作经历 (as the popup does).
  if (Array.isArray(stored.fillModules) && (stored.fillModulesVersion ?? 0) < 3 && stored.fillModules.includes("experience") && !stored.fillModules.includes("campus")) stored.fillModules = [...stored.fillModules, "campus"];
  // 专业技能 boxes were filled as 其他字段 before they had a module of their own.
  if (Array.isArray(stored.fillModules) && (stored.fillModulesVersion ?? 0) < 4 && stored.fillModules.includes("other") && !stored.fillModules.includes("skill")) stored.fillModules = [...stored.fillModules, "skill"];
  // v5 added 个人材料（证件照/成绩单/证书）: on for whoever already fills 简历附件.
  if (Array.isArray(stored.fillModules) && (stored.fillModulesVersion ?? 0) < 5 && stored.fillModules.includes("resume") && !stored.fillModules.includes("attachment")) stored.fillModules = [...stored.fillModules, "attachment"];
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
  let draftSignature = (await chrome.storage.session.get(`draft-signature:${tabId}`))[`draft-signature:${tabId}`];
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
        if (attached > 0) await recordUpload(tabId, filename, "resume");
        return attached;
      },
      uploadAttachments: async () => {
        const initialUrl = liveUrl;
        const listRes = await api("attachments", { signal: task?.controller.signal }).catch(() => null);
        if (!listRes || !listRes.ok) return { count: 0, labels: [] };
        const { attachments } = await listRes.json().catch(() => ({ attachments: [] }));
        if (!Array.isArray(attachments) || !attachments.length) return { count: 0, labels: [] };
        const byRole = new Map(attachments.map((item) => [item.role, item]));
        const frames = await tabFrames(tabId);
        const foundRoles = new Set();
        for (const frameId of frames) {
          const matched = await runInFrame(tabId, frameId, core.markTypedFileInputs, [[...byRole.keys()]]).catch(() => []);
          if (Array.isArray(matched)) matched.forEach((role) => foundRoles.add(role));
        }
        if (!foundRoles.size) return { count: 0, labels: [] };
        let count = 0;
        const labels = [];
        for (const role of foundRoles) {
          const item = byRole.get(role);
          if (!item) continue;
          if (liveUrl !== initialUrl || task?.controller.signal.aborted) break;
          const fileRes = await api(`attachment-file?attachmentId=${encodeURIComponent(item.id)}`, { signal: task?.controller.signal }).catch(() => null);
          if (!fileRes || !fileRes.ok) continue;
          const filename = decodeURIComponent(fileRes.headers.get("x-file-name") || item.uploadName || item.name);
          const base64 = bytesToBase64(await fileRes.arrayBuffer());
          let attached = 0;
          for (const frameId of frames) {
            if (liveUrl !== initialUrl || task?.controller.signal.aborted) break;
            attached += (await runInFrame(tabId, frameId, core.attachTypedFile, [role, base64, filename, fileRes.headers.get("content-type")]).catch(() => 0)) || 0;
          }
          if (attached > 0) {
            count += attached;
            if (!labels.includes(item.category)) labels.push(item.category);
            await recordUpload(tabId, filename, item.category || role);
          }
        }
        return { count, labels };
      },
      jobId: () => task?.positionId ?? boundJob,
      archiveScope: () => (task?.positionId ?? boundJob) ? `job:v1:${task?.positionId ?? boundJob}` : core.portalContext(liveUrl),
      getPlan: () => plans.get(tabId),
      setPlan: async (plan) => { if (plan) { plans.set(tabId, plan); await chrome.storage.session.set({ [`plan:${tabId}`]: { ...plan, frameById: [...plan.frameById] } }); } else { plans.delete(tabId); await chrome.storage.session.remove(`plan:${tabId}`); } },
      getDrafts: () => drafts.get(tabId) || [],
      getDraftSignature: () => draftSignature,
      setDraftSignature: (signature) => { draftSignature = signature; chrome.storage.session.set({ [`draft-signature:${tabId}`]: signature }).catch(() => {}); },
      setDrafts: (list) => storeDrafts(tabId, list),
    },
  };
}

async function recordUpload(tabId, name, category) {
  const key = `archive:${tabId}`;
  const prev = (await chrome.storage.session.get(key))[key] || {};
  const uploads = Array.isArray(prev.uploads) ? prev.uploads : [];
  const next = [...uploads.filter((item) => item.name !== name), { name: String(name).slice(0, 120), category: String(category || "").slice(0, 60) }].slice(-20);
  await chrome.storage.session.set({ [key]: { ...prev, uploads: next } }).catch(() => {});
}

async function installArchiveWatchers(tabId, contextKey) {
  for (const frameId of await tabFrames(tabId).catch(() => [])) {
    await runInFrame(tabId, frameId, core.readCurrentApplicationFields).catch(() => {});
    await runInFrame(tabId, frameId, core.watchApplicationFields, [contextKey]).catch(() => {});
  }
}

async function undoTabAutofill(tabId, keepUserEdited = true) {
  let cleared = 0;
  for (const frameId of await tabFrames(tabId).catch(() => [])) {
    const res = await runInFrame(tabId, frameId, core.resetAutofillInFrame, [keepUserEdited]).catch(() => ({ cleared: 0 }));
    cleared += res?.cleared || 0;
  }
  plans.delete(tabId);
  await chrome.storage.session.remove(`plan:${tabId}`).catch(() => {});
  return cleared;
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
    if (options.forceRefill) await undoTabAutofill(tabId, true);
    const ready = await adapterFor(tabId, task);
    dispose = ready.dispose;
    const adapter = ready.adapter;
    for (const frameId of await tabFrames(tabId)) await runInFrame(tabId, frameId, (id) => document.documentElement.setAttribute("data-cp-task", id), [task.id]).catch(() => {});
    const prefs = await settings();
    const session = await chrome.storage.session.get([`plan:${tabId}`, `job:${tabId}`, `archive:${tabId}`]);
    if (!plans.has(tabId) && session[`plan:${tabId}`]) { const plan = session[`plan:${tabId}`]; plans.set(tabId, { ...plan, frameById: new Map(plan.frameById) }); }
    const resumeVersionId = options.resumeVersionId ?? prefs.resumeVersionId ?? undefined;
    task.positionId = options.positionId ?? session[`job:${tabId}`];
    if (options.mode === "apply") {
      const applied = await core.applyAutofillPlan(adapter, options);
      await installArchiveWatchers(tabId, adapter.archiveScope());
      return applied;
    }
    const prevArchive = session[`archive:${tabId}`] || {};
    const contextKey = task.positionId ? `job:v1:${task.positionId}` : core.portalContext(adapter.url());
    await chrome.storage.session.set({ [`archive:${tabId}`]: { ...prevArchive, resumeVersionId: resumeVersionId || undefined, variantId: options.variantId ?? prefs.variantId, positionId: task.positionId, contextKey } });
    await trackTabVisit(tabId, adapter.url(), (await chrome.tabs.get(tabId).catch(() => ({}))).title || "").catch(() => {});
    const result = await core.runAutofillCore(adapter, resumeVersionId || undefined, {
      mode: options.mode, questionIds: options.questionIds, previewEdits: options.previewEdits, positionId: task.positionId, regenerate: options.regenerate, answerLength: options.answerLength,
      variantId: options.variantId ?? prefs.variantId ?? undefined,
      expandBlocks: options.expandBlocks ?? !!prefs.expandBlocks,
      // 只有在弹出窗口/快捷键显式触发时才按设置逐段保存。
      saveBlocks: !!options.saveBlocks,
      modules: options.modules ?? prefs.fillModules,
    });
    await installArchiveWatchers(tabId, contextKey);
    // 填写统计: what this fill did, and when (a later hand-typed page saves a sample).
    if (result?.phase === "done" && result.summary) {
      chrome.storage.session.set({ [`filled-at:${tabId}`]: Date.now() }).catch(() => {});
      chrome.storage.session.remove(`typed:${tabId}`).catch(() => {});
      api("fill-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: adapter.url(), fills: 1, filled: result.summary.filled || 0, manual: result.summary.manual || 0 }) }).catch(() => {});
    }
    return result;
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

// Several boxes typed by hand after 一键填写 = boxes it missed: the page's
// structure (never the values) goes to 网申样本 in the App, one per page a day.
const AUTO_SAMPLE_TYPED = 3;

async function captureSample(tabId, note) {
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url);
  const frames = [];
  for (const frameId of await tabFrames(tabId)) {
    try {
      const fields = (await runInFrame(tabId, frameId, core.scanPageFields, ["s-", true])) || [];
      const html = await runInFrame(tabId, frameId, core.formSkeleton);
      frames.push({
        url: frameId === 0 ? `${url.origin}${url.pathname}` : "",
        fields: fields.map((f) => ({ tag: f.tag, type: f.type, label: f.label, placeholder: f.placeholder, name: f.name, section: f.section, options: f.options, required: f.required, maxLength: f.maxLength, hadValue: !!f.hasValue, savedEntries: f.savedEntries ? f.savedEntries.length : 0, blockKey: f.blockKey ? "yes" : undefined })),
        html: typeof html === "string" ? html.slice(0, 400000) : undefined,
      });
    } catch { /* A frame that refuses scripts has no form to show. */ }
  }
  if (!frames.some((frame) => frame.fields.length)) return;
  return jsonOrThrow(await api("sample", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page: `${url.origin}${url.pathname}`, title: (tab.title || "").slice(0, 300), note, frames: frames.slice(0, 20) }) }));
}

// A 网申 box asking something to write, not a fact: what 小欧 can draft.
const OPEN_QUESTION = /[?？]|请(?:简述|描述|介绍|谈谈|说明|列举|举例)|为什么|为何|如何|怎样|谈谈|简述|描述|介绍一下|你的|你在|经历中|why|how|describe|tell us|explain/i;

/** What 小欧 sees of the tab: title, address, visible text and the open questions on it. */
async function pageContext(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/i.test(tab.url || "")) return null;
  const text = (await runInFrame(tabId, 0, () => (document.body ? document.body.innerText : "").replace(/\s+\n/g, "\n").slice(0, 6000)).catch(() => "")) || "";
  const questions = [];
  for (const frameId of await tabFrames(tabId)) {
    const fields = (await runInFrame(tabId, frameId, core.scanPageFields, ["s-", true]).catch(() => [])) || [];
    for (const field of fields) if ((field.label || "").length >= 6 && OPEN_QUESTION.test(field.label) && questions.length < 20) questions.push({ label: field.label.slice(0, 500), value: String(field.currentValue || "").slice(0, 3000) });
  }
  const positionId = (await chrome.storage.session.get(`job:${tabId}`))[`job:${tabId}`] || undefined;
  return { url: tab.url.slice(0, 2000), title: (tab.title || "").slice(0, 300), text, questions, positionId };
}

/** 小欧's 「填进这一栏」: the drafted answer into the box with that question. */
async function fillField(tabId, label, value, overwrite) {
  const norm = (text) => String(text || "").normalize("NFKC").replace(/[\s*＊:：?？。.，,、（）()「」“”"'【】[\]]/g, "").toLowerCase();
  const want = norm(label);
  const run = Date.now().toString(36).slice(-4);
  const frames = await tabFrames(tabId);
  for (const [index, frameId] of frames.entries()) {
    const fields = (await runInFrame(tabId, frameId, core.scanPageFields, [`x${index}${run}-`]).catch(() => [])) || [];
    const boxes = fields.filter((field) => ["input", "textarea", "richtext"].includes(field.tag) && !field.options && !["date", "month", "number", "email", "tel"].includes(field.type));
    const field = boxes.find((item) => norm(item.label) === want) || boxes.find((item) => { const own = norm(item.label); return own.length >= 6 && (own.includes(want.slice(0, 24)) || want.includes(own)); });
    if (!field) continue;
    if (field.hasValue && !overwrite) return { ok: false, needsConfirm: true };
    if (field.hasValue) {
      await runInFrame(tabId, frameId, (id) => {
        const findById = (root, targetId) => {
          const hit = root.querySelector(`[data-cp-fill-id="${CSS.escape(targetId)}"]`);
          if (hit) return hit;
          for (const node of root.querySelectorAll("*")) {
            if (node.shadowRoot) { const nested = findById(node.shadowRoot, targetId); if (nested) return nested; }
          }
          return null;
        };
        const el = findById(document, id);
        if (!el) return;
        el.removeAttribute("data-cp-user-edited");
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (setter && "value" in el) {
          const prev = el.value;
          setter.call(el, "");
          if (el._valueTracker && typeof el._valueTracker.setValue === "function") el._valueTracker.setValue(prev);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (el.isContentEditable) el.textContent = "";
      }, [field.id]).catch(() => {});
    }
    const result = await runInFrame(tabId, frameId, core.fillFields, [[{ id: field.id, value, source: "ai", label: field.label, tag: field.tag }]]);
    await runInFrame(tabId, frameId, core.focusFormField, [field.id]).catch(() => {});
    return result?.filled?.includes(field.id) ? { ok: true } : { ok: false, reason: "这一栏没填进去，可以复制后自己粘贴" };
  }
  return { ok: false, reason: "没在页面上找到这道题，可能换页了；可以复制后自己粘贴" };
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
    const { resumeVersionId, variantId, autoRemember } = await settings();
    const result = await core.saveCorrectionsCore(context.adapter, resumeVersionId || undefined, onlyUserEdited, variantId || undefined, !onlyUserEdited || autoRemember !== false);
    if (result?.handTyped) {
      const url = context.adapter.url();
      api("fill-stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, typed: result.handTyped }) }).catch(() => {});
      const filledAt = (await chrome.storage.session.get(`filled-at:${tabId}`))[`filled-at:${tabId}`];
      if (filledAt && Date.now() - filledAt < 6 * 3_600_000) {
        // Counted per page since the fill: captures run on every blur, one box at a time.
        const key = `typed:${tabId}`;
        const page = url.split("#")[0];
        const before = (await chrome.storage.session.get(key))[key];
        const typed = (before && before.page === page ? before.count : 0) + result.handTyped;
        await chrome.storage.session.set({ [key]: { page, count: typed } });
        if (typed >= AUTO_SAMPLE_TYPED) captureSample(tabId, `自动保存（插件）：一键填写后手填了 ${typed} 个字段`).catch(() => {});
      }
    }
    return result;
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

function installSubmitFlush() {
  if (window.__cpSubmitFlushInstalled) return;
  window.__cpSubmitFlushInstalled = true;
  const captureNow = () => {
    try {
      const fields = typeof window.__cpReadApplicationFields === "function" ? window.__cpReadApplicationFields() : [];
      if (!fields.length) return;
      const prev = JSON.parse(sessionStorage.getItem("cp-submission-fields") || "null");
      sessionStorage.setItem("cp-submission-fields", JSON.stringify({ at: Date.now(), url: location.href, fields, contextKey: prev?.contextKey || window.__cpArchiveContextKey || location.origin }));
    } catch {}
  };
  document.addEventListener("submit", captureNow, true);
  document.addEventListener("click", (event) => {
    if (event.target?.closest?.("button, input[type='submit'], [role='button']")) captureNow();
  }, true);
}

async function watchMemory(tabId, enabled) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || "")) return { enabled: false };
  const origin = new URL(tab.url).origin;
  await chrome.storage.session.set({ [`memory:${tabId}`]: { enabled: true, discover: enabled, origin } });
  const { adapter, dispose } = await adapterFor(tabId);
  try {
    // Register field ids and tracking before the first handwritten value,
    // including pages where the applicant never clicks Autofill.
    await core.scanFrames(adapter);
    const contextKey = adapter.archiveScope();
    for (const frame of await tabFrames(tabId)) {
      await runInFrame(tabId, frame, installMemoryWatcher, [true]).catch(() => {});
      await runInFrame(tabId, frame, installSubmitFlush).catch(() => {});
      await runInFrame(tabId, frame, core.readCurrentApplicationFields).catch(() => {});
      await runInFrame(tabId, frame, core.watchApplicationFields, [contextKey]).catch(() => {});
    }
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
    if (result.draftSaved || result.pendingTotal !== undefined) {
      // Everything this page wrote into 网申资料 so far, for one 撤销 in the popup.
      const previous = (await chrome.storage.session.get(`memory-status:${tabId}`))[`memory-status:${tabId}`];
      const earlier = previous?.url === tab.url && Array.isArray(previous.learned) ? previous.learned : [];
      const learned = [...earlier.filter((item) => !(result.learned || []).some((next) => next.id === item.id)), ...(result.learned || [])].slice(-40);
      const status = { pending: result.pendingTotal || 0, draftSaved: result.draftSaved, url: tab.url, at: Date.now(), learned };
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

async function trackTabVisit(tabId, url, title) {
  if (!/^https?:/i.test(url || "")) return;
  const { base } = await settings();
  try {
    if (new URL(url).origin === new URL(base).origin) return;
  } catch {}
  const key = `history:${tabId}`;
  const stored = (await chrome.storage.session.get(key))[key] || [];
  const nextItem = { url: url.slice(0, 16384), title: String(title || "").slice(0, 300) };
  const last = stored[stored.length - 1];
  const next = last && last.url === nextItem.url ? [...stored.slice(0, -1), nextItem] : [...stored, nextItem].slice(-15);
  await chrome.storage.session.set({ [key]: next }).catch(() => {});
  // Capture JD page snippet cleanly if it looks like a job listing rather than a long form.
  const jdInfo = await runInFrame(tabId, 0, () => {
    const editable = Array.from(document.querySelectorAll("input:not([type='hidden']), textarea, select")).filter((el) => {
      const r = el.getBoundingClientRect();
      return !el.disabled && r.width > 0 && r.height > 0;
    }).length;
    const text = (document.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const looksLikeJd = /职位描述|岗位职责|任职要求|工作职责|职位要求|工作地点|job description|responsibilities|qualifications/i.test(text);
    if (!looksLikeJd && editable > 5) return null;
    if (editable > 10 || text.length < 60) return null;
    const headings = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("h1, h2, h3, [class*='title' i], [class*='job-name' i], [class*='position' i]")) {
      const line = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (line.length >= 2 && line.length <= 60 && !seen.has(line)) {
        seen.add(line);
        headings.push(line);
        if (headings.length >= 6) break;
      }
    }
    return { text: text.slice(0, 4000), headings };
  }).catch(() => null);
  if (jdInfo?.text) {
    await chrome.storage.session.set({ [`jd:${tabId}`]: { url: url.slice(0, 2000), ...jdInfo } }).catch(() => {});
  }
}

async function pageInfo(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const text = (await runInFrame(tabId, 0, core.capturePageText).catch(() => "")) || "";
  const success = await runInFrame(tabId, 0, core.detectApplicationSuccess).catch(() => null);
  return { url: tab.url || "", title: tab.title || "", text, success };
}

// What the submitted form said (this page's fields, or the previous step's
// kept for the success page), for the material package and for naming the job.
async function submittedFields(tabId, url) {
  const session = await chrome.storage.session.get([`job:${tabId}`, `archive:${tabId}`, `history:${tabId}`, `jd:${tabId}`]);
  const archive = session[`archive:${tabId}`] || {};
  const positionId = session[`job:${tabId}`] || undefined;
  const fields = [];
  const contextKey = archive.contextKey || (positionId ? `job:v1:${positionId}` : core.portalContext(url));
  const frames = await tabFrames(tabId).catch(() => []);
  for (const frame of frames) {
    await runInFrame(tabId, frame, core.readCurrentApplicationFields).catch(() => {});
    fields.push(...((await runInFrame(tabId, frame, core.collectApplicationFields, [contextKey]).catch(() => [])) || []));
  }
  if (!fields.length) {
    const seen = new Set();
    for (const frame of frames) {
      const scanned = (await runInFrame(tabId, frame, core.scanPageFields, ["ro-", true]).catch(() => [])) || [];
      for (const f of scanned) {
        const label = String(f.label || f.placeholder || f.name || "").replace(/\s+/g, " ").trim().slice(0, 200);
        const value = String(f.currentValue || "").trim().slice(0, 5000);
        if (!label || !value || f.type === "password" || f.type === "file") continue;
        if (/密码|验证码|证件|身份证|银行卡|护照|家庭住址|password|captcha|passport|social security|bank account/i.test(label) || /\d{17}[\dXx]/.test(value) || /^\+\d{1,4}$/.test(value)) continue;
        const key = `${label}:${value}`;
        if (!seen.has(key) && fields.length < 250) {
          seen.add(key);
          fields.push({ label, value });
        }
      }
    }
  }
  return { fields, archive, positionId, history: session[`history:${tabId}`] || [], jd: session[`jd:${tabId}`] || null };
}

async function insertIntoFocusedTab(tabId, value) {
  const frames = await tabFrames(tabId);
  let bestFrame = frames[0] ?? 0;
  let bestAt = 0;
  for (const frameId of frames) {
    const at = (await runInFrame(tabId, frameId, core.lastFieldFocusAt).catch(() => 0)) || 0;
    if (at > bestAt) { bestAt = at; bestFrame = frameId; }
  }
  return (await runInFrame(tabId, bestFrame, core.insertIntoLastField, [String(value)]).catch(() => null)) || { ok: false, reason: "先在网页上点一下要填的输入框" };
}

async function runAgentTurn(tabId, text) {
  const content = String(text || "").trim();
  if (!content) return;
  const agentKey = `agent:${tabId}`;
  const stateKey = `agent-state:${tabId}`;
  const curState = (await chrome.storage.session.get(stateKey))[stateKey];
  if (curState?.busy) throw new Error("小欧还在思考上一条消息");
  const history = ((await chrome.storage.session.get(agentKey))[agentKey] || []).slice(-40);
  const compactHistory = history.map(({ role, content: itemContent }) => ({ role, content: itemContent })).slice(-20);
  history.push({ role: "user", content });
  await chrome.storage.session.set({
    [agentKey]: history.slice(-40),
    [stateKey]: { busy: true, working: "小欧在想该怎么做…" },
  });
  chrome.runtime.sendMessage({ type: "agent-state", tabId, busy: true, working: "小欧在想该怎么做…", history: history.slice(-40) }).catch(() => {});
  const stop = keepAlive();
  try {
    const page = await pageContext(tabId).catch(() => null);
    const res = await api("agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: content, history: compactHistory, ...(page ? { page } : {}) }),
    });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || "小欧暂时连不上，请确认求职罗盘 App 开着");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", done = null;
    while (!done) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "step" && event.step) {
          const working = `小欧正在做：${event.step.label}`;
          chrome.storage.session.set({ [stateKey]: { busy: true, working } }).catch(() => {});
          chrome.runtime.sendMessage({ type: "agent-state", tabId, busy: true, working }).catch(() => {});
        } else if (event.type === "note" && event.text) {
          chrome.storage.session.set({ [stateKey]: { busy: true, working: event.text } }).catch(() => {});
          chrome.runtime.sendMessage({ type: "agent-state", tabId, busy: true, working: event.text }).catch(() => {});
        } else if (event.type === "done" || event.type === "error") done = event;
      }
      if (chunk.done && !done) throw new Error("连接中断，本次请求未完成");
    }
    if (done.type === "error") throw new Error(done.message);
    const reply = { role: "assistant", content: done.reply, drafts: done.drafts || [], actionsNote: done.actions?.length ? "小欧建议改的记录（记投递、改进度等）请在求职罗盘 App 里的小欧点按钮确认。" : "" };
    const nextHistory = [...history, reply].slice(-40);
    await chrome.storage.session.set({ [agentKey]: nextHistory, [stateKey]: { busy: false, working: "" } });
    chrome.runtime.sendMessage({ type: "agent-state", tabId, busy: false, working: "", history: nextHistory }).catch(() => {});
  } catch (error) {
    const nextHistory = history.slice(0, -1);
    const errMsg = error.message || "小欧这次没跑完";
    await chrome.storage.session.set({ [agentKey]: nextHistory, [stateKey]: { busy: false, working: "", error: errMsg } });
    chrome.runtime.sendMessage({ type: "agent-state", tabId, busy: false, working: "", error: errMsg, history: nextHistory }).catch(() => {});
  } finally {
    stop();
  }
}

const BATCH_KEY = "batch-queue";
let batchDraining = false;
let batchStopRequested = false;

async function readBatchQueue() {
  return (await chrome.storage.session.get(BATCH_KEY))[BATCH_KEY] || [];
}

async function writeBatchQueue(list) {
  await chrome.storage.session.set({ [BATCH_KEY]: list }).catch(() => {});
  chrome.runtime.sendMessage({ type: "batch-update", queue: list }).catch(() => {});
}

async function updateBatchItem(tabId, patch) {
  const list = await readBatchQueue();
  const next = list.map((item) => item.tabId === tabId ? { ...item, ...patch, updatedAt: Date.now() } : item);
  await writeBatchQueue(next);
}

async function drainBatchQueue(fallbackOptions = {}) {
  if (batchDraining) return;
  batchDraining = true;
  batchStopRequested = false;
  const stop = keepAlive();
  try {
    const worker = async () => {
      while (!batchStopRequested) {
        const list = await readBatchQueue();
        const nextItem = list.find((item) => item.status === "queued");
        if (!nextItem) return;
        const itemOptions = nextItem.options ? { ...fallbackOptions, ...nextItem.options } : fallbackOptions;
        await updateBatchItem(nextItem.tabId, { status: "filling", message: "正在自动填写…" });
        try {
          const tab = await chrome.tabs.get(nextItem.tabId);
          if (!/^https?:/i.test(tab.url || "")) {
            await updateBatchItem(nextItem.tabId, { status: "error", message: "非网页标签页，已跳过" });
            continue;
          }
          const result = await fillTab(nextItem.tabId, itemOptions);
          if (batchStopRequested) break;
          const filled = result?.summary?.filled || 0;
          const manual = result?.summary?.manual || 0;
          const uploaded = result?.summary?.uploaded || 0;
          const uploadedNames = Array.isArray(result?.summary?.uploadedAttachments) ? result.summary.uploadedAttachments : [];
          const page = filled === 0 ? await pageInfo(nextItem.tabId).catch(() => ({ text: "" })) : null;
          const needsLogin = result?.phase === "error"
            ? false
            : filled === 0 && /登录|注册|请先登录|扫码登录|sign in|log in|verify|验证码/i.test((page?.text || "").slice(0, 1500));
          const attachNote = uploaded > 0 ? `，附传 ${uploaded} 份附件` : "";
          await updateBatchItem(nextItem.tabId, {
            title: tab.title || nextItem.title,
            url: tab.url || nextItem.url,
            status: needsLogin ? "needs_login" : result?.phase === "error" ? "error" : "ready",
            filled,
            manual,
            uploaded,
            uploadedNames,
            message: needsLogin ? "可能需要登录或验证，完成后点「重填」" : (result?.message || `已填 ${filled} 项${attachNote}，待确认提交`),
          });
        } catch (err) {
          if (batchStopRequested) break;
          await updateBatchItem(nextItem.tabId, { status: "error", message: err?.message || "标签页已关闭或无法访问" });
        }
      }
    };
    await Promise.all([worker(), worker()]);
  } finally {
    stop();
    batchDraining = false;
  }
}

const handlers = {
  async pageContext({ tabId }) { return pageContext(tabId); },
  async fillField({ tabId, label, value, overwrite }) {
    if (typeof label !== "string" || typeof value !== "string" || !value.trim() || value.length > 20000) throw new Error("回答内容不对");
    return fillField(tabId, label, value, overwrite === true);
  },
  async insert({ tabId, value }) {
    if (typeof value !== "string" || !value) throw new Error("没有可填入的内容");
    return insertIntoFocusedTab(tabId, value);
  },
  async undoFill({ tabId }) {
    const cleared = await undoTabAutofill(tabId, true);
    broadcast(tabId, { phase: "done", message: cleared > 0 ? `已撤销刚才填入的 ${cleared} 处内容（你手填的已保留）` : "这页没有可撤销的自动填写内容", details: [], summary: { filled: 0, manual: 0, preserved: 0, excluded: 0, uploaded: 0 } });
    return { cleared };
  },
  async watchMemory({ tabId, enabled }) { return watchMemory(tabId, enabled === true); },
  async undoLearned({ tabId, ids }) {
    const result = await jsonOrThrow(await api("undo-learned", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }));
    const key = `memory-status:${tabId}`;
    const status = (await chrome.storage.session.get(key))[key];
    if (status) await chrome.storage.session.set({ [key]: { ...status, learned: [] } });
    return result;
  },
  async memoryStatus({ tabId }) { const status = (await chrome.storage.session.get(`memory-status:${tabId}`))[`memory-status:${tabId}`]; const tab = await chrome.tabs.get(tabId); return status?.url === tab.url ? status : null; },
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
  async identify({ tabId }) {
    const page = await pageInfo(tabId);
    if (!/^https?:/.test(page.url)) return { companyName: "", title: "", evidence: [] };
    const { fields, history, jd } = await submittedFields(tabId, page.url);
    return jsonOrThrow(await api("identify-application", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: page.url,
        title: page.title.slice(0, 300),
        text: page.text.slice(0, 4000),
        history,
        fields: fields.slice(0, 250),
        ...(jd ? { jdText: jd.text.slice(0, 4000), jdHeadings: (jd.headings || []).slice(0, 6) } : {}),
      }),
    }));
  },
  async record({ tabId, companyName, title, applyUrl, resumeVersionId, recognizedPositionId, city, auto }) {
    const prefs = await settings();
    const { fields, archive, positionId: bound, jd } = await submittedFields(tabId, applyUrl);
    // A recognised pool job is linked only when nothing was bound while filling.
    const positionId = bound || (!archive.positionId && recognizedPositionId) || undefined;
    const saved = await jsonOrThrow(await api("record-application", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName,
        title,
        applyUrl,
        appliedDate: new Date().toISOString(),
        resumeVersionId,
        positionId,
        ...(city ? { city } : {}),
        ...(auto ? { auto: true } : {}),
        ...(jd ? { jd: { url: jd.url, text: jd.text.slice(0, 8000) } } : {}),
        snapshot: {
          fields,
          url: applyUrl,
          resumeVersionId: archive.resumeVersionId || resumeVersionId,
          variantId: archive.variantId || prefs.variantId,
          positionId: archive.positionId || positionId,
        },
      }),
    }));
    await updateBatchItem(tabId, { status: "confirmed", companyName, jobTitle: title, message: "已记入投递记录" });
    return saved;
  },
  async portal({ companyId, url }) {
    return jsonOrThrow(await api("portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, url }) }));
  },
  async lastStatus({ tabId }) {
    const key = `status:${tabId}`;
    return (await chrome.storage.session.get(key))[key] || null;
  },
  async askAgent({ tabId, text }) {
    runAgentTurn(tabId, text);
    return { started: true };
  },
  async agentState({ tabId }) {
    const data = await chrome.storage.session.get([`agent:${tabId}`, `agent-state:${tabId}`]);
    return { history: data[`agent:${tabId}`] || [], state: data[`agent-state:${tabId}`] || { busy: false, working: "" } };
  },
  async clearAgent({ tabId }) {
    await chrome.storage.session.remove([`agent:${tabId}`, `agent-state:${tabId}`]);
    return { cleared: true };
  },
  async listTabs() {
    const { base } = await settings();
    let appOrigin = "";
    try { appOrigin = new URL(base).origin; } catch {}
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const webTabs = tabs
      .filter((t) => /^https?:/i.test(t.url || "") && (!appOrigin || !t.url.startsWith(appOrigin)))
      .map((t) => ({ id: t.id, title: t.title || t.url, url: t.url, active: !!t.active }));
    const queue = await readBatchQueue();
    return { tabs: webTabs, queue };
  },
  async batchFill({ tabIds, ...options }) {
    const selectedIds = Array.isArray(tabIds) ? tabIds.filter((id) => Number.isInteger(id)) : [];
    if (!selectedIds.length) throw new Error("请至少勾选一个网页标签页");
    const existing = await readBatchQueue();
    const byId = new Map(existing.map((item) => [item.tabId, item]));
    for (const id of selectedIds) {
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (!tab || !/^https?:/i.test(tab.url || "")) continue;
      byId.set(id, {
        tabId: id,
        url: tab.url,
        title: tab.title || tab.url,
        status: "queued",
        filled: 0,
        manual: 0,
        uploaded: 0,
        uploadedNames: [],
        options,
        message: "排队等待自动填写…",
        updatedAt: Date.now(),
      });
    }
    const queue = [...byId.values()];
    await writeBatchQueue(queue);
    drainBatchQueue(options);
    return { started: true, queue };
  },
  async batchRefill({ tabId, ...options }) {
    const list = await readBatchQueue();
    const existing = list.find((item) => item.tabId === tabId);
    const mergedOptions = { ...(existing?.options || {}), ...options, forceRefill: true };
    await updateBatchItem(tabId, { status: "queued", options: mergedOptions, message: "重新排队填写…" });
    drainBatchQueue(mergedOptions);
    return { started: true };
  },
  async batchStop() {
    batchStopRequested = true;
    const list = await readBatchQueue();
    const next = list.map((item) => {
      if (item.status === "filling") cancelFill(item.tabId);
      if (item.status === "queued" || item.status === "filling") {
        return { ...item, status: "error", message: "已暂停批量填写", updatedAt: Date.now() };
      }
      return item;
    });
    await writeBatchQueue(next);
    return { stopped: true, queue: next };
  },
  async batchRemove({ tabId }) {
    const next = (await readBatchQueue()).filter((item) => item.tabId !== tabId);
    await writeBatchQueue(next);
    return { queue: next };
  },
  async batchClearDone() {
    const next = (await readBatchQueue()).filter((item) => !["confirmed", "error"].includes(item.status));
    await writeBatchQueue(next);
    return { queue: next };
  },
  async focusTab({ tabId }) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return { focused: true };
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
  const prefs = await settings().catch(() => ({}));
  fillTab(tab.id, { saveBlocks: !!(prefs.expandBlocks && prefs.saveBlocks !== false) });
});

async function tryAutoRecordOnSuccess(tabId, tab) {
  const prefs = await settings().catch(() => ({}));
  if (!prefs.autoRecord) return;
  const filledAt = (await chrome.storage.session.get(`filled-at:${tabId}`))[`filled-at:${tabId}`];
  if (!filledAt || Date.now() - filledAt > 4 * 3_600_000) return;
  const page = await pageInfo(tabId).catch(() => null);
  if (!page?.success || !/^https?:/i.test(page.url)) return;
  const found = await handlers.identify({ tabId }).catch(() => null);
  if (!found?.companyName || !found?.title) return;
  const res = await handlers.record({
    tabId,
    companyName: found.companyName,
    title: found.title,
    applyUrl: tab.url || page.url,
    resumeVersionId: prefs.resumeVersionId || undefined,
    recognizedPositionId: found.positionId,
    auto: true,
  }).catch(() => null);
  if (res && !res.duplicate) {
    broadcast(tabId, {
      phase: "done",
      message: `已自动记入投递记录：${found.companyName} · ${found.title}`,
      details: [],
      summary: { filled: 0, manual: 0, preserved: 0, excluded: 0, uploaded: 0 },
    });
  }
}

chrome.webNavigation.onHistoryStateUpdated.addListener(({ tabId, url }) => {
  plans.delete(tabId);
  chrome.storage.session.remove(`plan:${tabId}`).catch(() => {});
  cancelFill(tabId, "页面已变化，填写已停止");
  if (url) chrome.tabs.get(tabId).then((t) => trackTabVisit(tabId, t.url || url, t.title)).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "loading") { plans.delete(tabId); chrome.storage.session.remove([`plan:${tabId}`, `memory-status:${tabId}`, `draft-signature:${tabId}`]).catch(() => {}); }
  if (info.status === "complete" && tab?.url) {
    trackTabVisit(tabId, tab.url, tab.title).catch(() => {});
    tryAutoRecordOnSuccess(tabId, tab).catch(() => {});
    chrome.storage.session.get(`memory:${tabId}`).then(async (stored) => {
      const state = stored[`memory:${tabId}`]; if (!state?.enabled) return;
      if (/^https?:/.test(tab.url || "") && new URL(tab.url).origin === state.origin) await watchMemory(tabId, true);
    }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  cancelFill(tabId, "标签页已关闭，填写已停止");
  drafts.delete(tabId);
  plans.delete(tabId);
  chrome.storage.session.remove([`status:${tabId}`, `drafts:${tabId}`, `plan:${tabId}`, `job:${tabId}`, `archive:${tabId}`, `memory:${tabId}`, `memory-status:${tabId}`, `history:${tabId}`, `jd:${tabId}`, `agent:${tabId}`, `agent-state:${tabId}`]).catch(() => {});
  const nextQueue = (await readBatchQueue().catch(() => [])).filter((item) => item.tabId !== tabId);
  await writeBatchQueue(nextQueue).catch(() => {});
});
