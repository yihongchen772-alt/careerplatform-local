const crypto = require("node:crypto");
const { ipcMain, WebContentsView, BrowserWindow, Menu, session, shell, app, clipboard, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { createLoginStore, loginRealm, realmLabel } = require("./saved-logins");

// The page-injected helpers and field matchers live in autofill-core.js so
// the Chrome extension can reuse them unchanged.
const {
  BASIC_FIELD_RULES,
  CHINESE_ORDINALS,
  DEGREE_LEVELS,
  DEGREE_SYNONYMS,
  END_LABEL,
  NEEDS_MANUAL_INPUT,
  NEVER_GUESS_KEYWORDS,
  RANGE_LABEL,
  START_LABEL,
  UNTIL_NOW,
  bareLabel,
  capturePageText,
  clearFillMarks,
  clearSavedUserEdits,
  clickAddBlock,
  countFillableFields,
  dateFormatFor,
  dateParts,
  dateRangeValue,
  degreeAlternatives,
  degreeLevel,
  detectApplicationSuccess,
  educationFieldKind,
  educationRows,
  experienceFieldKind,
  fieldHaystack,
  fieldMemoryKey,
  fillCustomSelects,
  fillDetail,
  fillFields,
  formatDateForField,
  hasUserEditedFields,
  highestEducation,
  isForbiddenMemoryField,
  isNeverGuessField,
  isOpenEndedQuestionField,
  isSensitiveMemoryField,
  isSplitNameField,
  markResumeFileInputs,
  matchBasicField,
  matchDegreeOption,
  matchFieldOption,
  matchFlatField,
  matchRememberedField,
  memoryCandidate,
  missingRepeatBlocks,
  missingRepeatCounts,
  portalContext,
  profileSecrets,
  projectFieldKind,
  readFieldValues,
  repeatFieldGoesToAi,
  repeatFieldValue,
  resolveRepeatField,
  rowDateValue,
  scanPageFields,
  formSkeleton,
  sectionGroup,
  sectionOrdinal,
  snapshotFormStructure,
  applyAutofillPlan, focusFormField, collectApplicationFields, readCurrentApplicationFields,
  trackUserEdits,
  runAutofillCore,
  saveCorrectionsCore,
} = require("./autofill-core.js");

// Page-internal find: Electron's webContents.findInPage never emits
// found-in-page in this build (confirmed on the main window too), so the
// classic window.find() does the highlighting and scrolling instead. The
// total is counted over the visible text; `active` walks with each call.
function findInPageText(text, forward, restart) {
  if (!text) {
    window.getSelection().removeAllRanges();
    window.__cpFindState = null;
    return { active: 0, total: 0 };
  }
  const haystack = (document.body && document.body.innerText) || "";
  const needle = text.toLowerCase();
  let total = 0;
  let idx = haystack.toLowerCase().indexOf(needle);
  while (idx !== -1) {
    total++;
    idx = haystack.toLowerCase().indexOf(needle, idx + needle.length);
  }
  if (total === 0) {
    window.getSelection().removeAllRanges();
    window.__cpFindState = null;
    return { active: 0, total: 0 };
  }
  const state = window.__cpFindState && window.__cpFindState.text === text ? window.__cpFindState : null;
  if (restart || !state) {
    window.getSelection().removeAllRanges();
    window.__cpFindState = { text, active: 0 };
  }
  // window.find(text, caseSensitive, backwards, wrap, wholeWord, searchInFrames, showDialog)
  const found = window.find(text, false, !forward, true, false, true, false);
  if (found) {
    const st = window.__cpFindState;
    st.active = forward ? (st.active % total) + 1 : st.active <= 1 ? total : st.active - 1;
    return { active: st.active, total };
  }
  return { active: 0, total };
}

function normalizeUrl(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return "about:blank";
  if (/^(https?|file|about):/i.test(trimmed)) return trimmed;
  // Something without a dot is a search, not a host.
  if (!/\./.test(trimmed) || /\s/.test(trimmed)) {
    return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`;
  }
  return `https://${trimmed}`;
}

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const PARTITION = "persist:job-application-browser";
const HISTORY_LIMIT = 50;
// Login detection runs in every frame of a tab, isolated from the page (see
// browser-guest-preload.js).
const guestPreload = () => path.join(__dirname, "browser-guest-preload.js");

// ---- saved passwords ----
let loginStore = null;
function logins() {
  if (!loginStore) loginStore = createLoginStore({ dir: app.getPath("userData") });
  return loginStore;
}
// A typed account waiting for 保存 / 不保存, per tab (the password stays here,
// never in the App window).
const pendingLogins = new Map();
// What the key icon shows for a tab: the site's kept accounts.
const loginStates = new Map();
// Pop-up windows (微信扫码登录 and the like) belong to the tab that opened them.
const popupTabs = new Map();

function tabForSender(sender) {
  return tabs.find((t) => t.view.webContents === sender) || tabs.find((t) => t.id === popupTabs.get(sender.id)) || null;
}

// A secure page (or this machine): a kept password is filled in by itself
// only there; anywhere else it waits for a click on the key icon.
function autoFillAllowed(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || ["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

// Injected into one frame: puts an account into its login form, the way a
// person typing would (React/Vue see the input events). `overwrite`: the
// applicant picked this account, so replace what is there.
function fillLoginFields(username, password, overwrite) {
  const NOT_USERNAME = /验证码|校验码|动态码|短信|图形|captcha|verif|otp|\bcode\b/i;
  const HINT = /user|account|login|email|mail|phone|mobile|tel|账号|帐号|用户名|手机|邮箱|登录名/i;
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const describe = (el) => [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.getAttribute("autocomplete")].filter(Boolean).join(" ");
  const boxes = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible);
  const box = boxes[0];
  if (!box) return { filled: false };
  // 注册 / 改密码 (两个密码框，或标了 new-password): not a login — only fill
  // there when the applicant picked an account themselves.
  if (!overwrite && (boxes.length > 1 || box.getAttribute("autocomplete") === "new-password")) return { filled: false };
  let scope = box.closest("form");
  if (!scope) {
    scope = document.body;
    let node = box.parentElement;
    for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
      if (node.querySelectorAll("input").length >= 2) { scope = node; break; }
    }
  }
  const before = Array.from(scope.querySelectorAll("input")).filter((input) =>
    visible(input) && /^(?:text|email|tel|number|)$/i.test(input.getAttribute("type") || "text") && !NOT_USERNAME.test(describe(input)) && (input.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING));
  const user = before.find((input) => HINT.test(describe(input)) || input.getAttribute("autocomplete") === "username") || before[before.length - 1] || null;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const put = (el, value) => {
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.setAttribute("data-cp-saved-login", "1");
    el.style.backgroundColor = "rgb(232, 240, 254)";
  };
  let changed = false;
  if (user && username && (overwrite || !user.value)) { put(user, username); changed = true; }
  if (overwrite || !box.value) { put(box, password); changed = true; }
  box.blur();
  return { filled: changed };
}

function sendLoginState(tab, state) {
  if (state) loginStates.set(tab.id, state);
  else loginStates.delete(tab.id);
  send("browser:login-state", { tabId: tab.id, state: state || null });
}

// Frames of a tab that show a password box and belong to `realm`.
async function loginFramesFor(tab, realm, sameOrigin = false) {
  const frames = [];
  for (const frame of allFrames(tab.view.webContents)) {
    const frameRealm = loginRealm(frame.url);
    if (!frameRealm) continue;
    let matches = frameRealm === realm;
    if (!matches && sameOrigin) {
      try { matches = new URL(frame.url).origin === new URL(realm.replace(/\?.*$/, "")).origin; } catch { matches = false; }
    }
    if (!matches) continue;
    const hasBox = await frame.executeJavaScript('Array.from(document.querySelectorAll(\'input[type="password"]\')).some((el) => el.getClientRects().length > 0)').catch(() => false);
    if (hasBox) frames.push(frame);
  }
  return frames;
}

// Module-level, not per-call: on mac, closing the window without background
// reminders on leaves the app running with zero windows, and `activate` then
// calls createWindow() again — a second real BrowserWindow, not a no-op.
// ipcMain.handle() throws if the same channel is registered twice, so the
// handlers below are wired up exactly once; only `currentWindow` (and the
// view's attachment to it) gets rebound on each call.
let registered = false;
let currentWindow = null;
let port = 0;
// Tabs: [{ id, view }]. Exactly one is attached to the window at a time.
const tabs = [];
let activeId = null;
let nextTabId = 1;
let lastBounds = null;
let attachedView = null;
// AI-answered fields from the most recent autofill run, per tab id —
// [{id, answerId, filledValue, frame}]. Reset on every autofill call.
const lastAiFilled = new Map();
const pendingPlans = new Map();
const savingAnswersForTabs = new Set();
const fillingTabs = new Set();
const fillTasks = new Map();
function stopFillTask(tabId, reason = "已停止填写，已填入的内容保留") {
  const task = fillTasks.get(tabId);
  if (!task || task.controller.signal.aborted) return;
  task.reason = reason;
  task.controller.abort();
  const tab = tabs.find((t) => t.id === tabId);
  if (tab && !tab.view.webContents.isDestroyed()) {
    for (const frame of allFrames(tab.view.webContents)) frame.executeJavaScript('document.documentElement.removeAttribute("data-cp-task")').catch(() => {});
  }
}
const submittedSignatures = new Map();

function assertTrustedBrowserEvent(event, window, expectedOrigin) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.sender.isDestroyed()) {
    throw new Error("仅允许求职罗盘主窗口操作网申浏览器。");
  }
  const frame = event.senderFrame;
  if (!frame || frame !== window.webContents.mainFrame) throw new Error("网申浏览器请求来源不受信任。");
  try {
    if (new URL(frame.url).origin !== expectedOrigin || new URL(event.sender.getURL()).origin !== expectedOrigin) {
      throw new Error("origin");
    }
  } catch {
    throw new Error("网申浏览器请求来源不受信任。");
  }
}

function send(channel, payload) {
  if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send(channel, payload);
}

function safeDownloadFilename(rawName) {
  const filename = path.basename(String(rawName || "").replace(/\\/g, "/"));
  return filename && filename !== "." && filename !== ".." ? filename : "download";
}

function openSafeExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    shell.openExternal(url.href).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function historyFile() {
  return path.join(app.getPath("userData"), "browser-history.json");
}

function readHistory() {
  try {
    const list = JSON.parse(fs.readFileSync(historyFile(), "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function recordHistory(url, title) {
  if (!url || /^(about:|chrome|devtools|file:)/.test(url)) return;
  const list = readHistory().filter((h) => h.url !== url);
  list.unshift({ url, title: (title || "").slice(0, 120), at: Date.now() });
  try {
    fs.writeFileSync(historyFile(), JSON.stringify(list.slice(0, HISTORY_LIMIT)));
  } catch {
    // History is a convenience; a write failure isn't worth surfacing.
  }
}

function activeTab() {
  return tabs.find((t) => t.id === activeId) || null;
}

function tabState(t) {
  const wc = t.view.webContents;
  return {
    id: t.id,
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    zoomFactor: wc.getZoomFactor(),
    favicon: t.favicon || null,
  };
}

// Tab icons are fetched through the 网申浏览器's own session (the page has
// already loaded them there), never from the App window, and handed to the
// renderer as small data URLs.
const faviconCache = new Map();
async function loadFavicon(tab, url) {
  tab.faviconUrl = url || null;
  if (!url) return;
  const show = (dataUrl) => {
    if (tab.faviconUrl !== url || tab.view.webContents.isDestroyed()) return;
    tab.favicon = dataUrl;
    sendTabsState();
  };
  if (url.startsWith("data:image/")) return show(url.length < 200000 ? url : null);
  if (!/^https?:\/\//i.test(url)) return;
  if (faviconCache.has(url)) return show(faviconCache.get(url));
  let dataUrl = null;
  try {
    const res = await session.fromPartition(PARTITION).fetch(url, { signal: AbortSignal.timeout(5000) });
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const bytes = res.ok && /^image\//.test(type) ? Buffer.from(await res.arrayBuffer()) : null;
    if (bytes && bytes.length > 0 && bytes.length <= 100 * 1024) dataUrl = `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    // No icon: the tab shows a globe.
  }
  faviconCache.set(url, dataUrl);
  if (faviconCache.size > 200) faviconCache.delete(faviconCache.keys().next().value);
  show(dataUrl);
}

// A blank tab shows the App's own 新标签页 underneath instead of a white page.
function hasPage(t) {
  const url = t.view.webContents.getURL();
  return !!url && url !== "about:blank";
}

function sendTabsState() {
  send("browser:tabs", { tabs: tabs.map(tabState), activeId });
}

function attach(t) {
  if (!currentWindow || currentWindow.isDestroyed()) return;
  if (attachedView && (attachedView !== t.view || !hasPage(t))) {
    currentWindow.contentView.removeChildView(attachedView);
    attachedView = null;
  }
  if (!hasPage(t)) return;
  if (lastBounds && attachedView !== t.view) {
    currentWindow.contentView.addChildView(t.view);
    attachedView = t.view;
  }
  if (lastBounds) t.view.setBounds(lastBounds);
}

function detach() {
  if (attachedView && currentWindow && !currentWindow.isDestroyed()) {
    currentWindow.contentView.removeChildView(attachedView);
  }
  attachedView = null;
}

function createTab(url, { activate = true } = {}) {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: session.fromPartition(PARTITION),
      // Not Node: with sandbox on, this only lets the login watcher run in
      // iframes too (many 网申 login boxes live in one).
      preload: guestPreload(),
      nodeIntegrationInSubFrames: true,
    },
  });
  view.setBackgroundColor("#ffffff");
  const tab = { id: nextTabId++, view, revision: 0 };
  tabs.push(tab);
  const wc = view.webContents;

  wc.on("did-start-navigation", () => {
    tab.revision++;
    pendingPlans.delete(tab.id);
    stopFillTask(tab.id, "页面已变化，已停止填写；请在当前页面重新填写");
  });
  wc.on("did-navigate", () => {
    lastAiFilled.delete(tab.id);
    // A new page: its own login box (if any) will announce itself.
    if (loginStates.has(tab.id)) sendLoginState(tab, null);
    // A new document brings its own icon; keep none rather than the last site's.
    tab.favicon = null;
    tab.faviconUrl = null;
    if (tab.id === activeId) attach(tab);
    sendTabsState();
  });
  wc.on("page-favicon-updated", (_event, favicons) => { void loadFavicon(tab, Array.isArray(favicons) ? favicons[0] : null); });
  wc.on("did-navigate-in-page", () => {
    tab.revision++;
    pendingPlans.delete(tab.id);
    stopFillTask(tab.id, "页面已变化，已停止填写；请在当前页面重新填写");
    sendTabsState();
  });
  wc.on("page-title-updated", () => {
    recordHistory(wc.getURL(), wc.getTitle());
    sendTabsState();
  });
  wc.on("did-start-loading", () => sendTabsState());
  wc.on("did-stop-loading", () => {
    recordHistory(wc.getURL(), wc.getTitle());
    sendTabsState();
    void installUserEditTrackers(wc);
  });
  // Cmd/Ctrl shortcuts land in the guest page when it has focus, which is
  // most of the time — forward the browser-chrome ones to our own UI.
  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.meta || input.control)) return;
    const key = input.key.toLowerCase();
    const map = { t: "new-tab", w: "close-tab", l: "focus-address", f: "find", r: "reload", "[": "back", "]": "forward" };
    if (!map[key]) return;
    event.preventDefault();
    if (map[key] === "reload") wc.reload();
    else if (map[key] === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (map[key] === "forward" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else {
      // The address bar and find box live in the App window: give it the
      // keyboard first, or the focus call there would land nowhere.
      if ((map[key] === "focus-address" || map[key] === "find") && currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.focus();
      send("browser:shortcut", { action: map[key], tabId: tab.id });
    }
  });
  // target=_blank links (JD pages, 投递入口) become tabs. Actual popups
  // (window.open with a size — 微信/企业微信扫码登录 lives in these) stay
  // real child windows so window.opener keeps working and the login round-
  // trips back into the page that started it; they share the partition, so
  // the cookies land where the tab expects them.
  wc.setWindowOpenHandler((details) => {
    if (details.disposition === "new-window" && details.features) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: currentWindow,
          width: 520,
          height: 640,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: session.fromPartition(PARTITION), preload: guestPreload(), nodeIntegrationInSubFrames: true },
        },
      };
    }
    createTab(details.url, { activate: true });
    return { action: "deny" };
  });
  // Electron pages have no context menu at all by default — right-click
  // does nothing, which on a form-heavy site feels broken. A small,
  // browser-like one.
  wc.on("context-menu", (_e, params) => {
    const template = [];
    if (params.linkURL) {
      template.push(
        { label: "在新标签页中打开链接", click: () => createTab(params.linkURL) },
        { label: "复制链接地址", click: () => clipboard.writeText(params.linkURL) },
        { type: "separator" }
      );
    }
    if (params.isEditable) {
      template.push(
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" },
        { type: "separator" }
      );
    } else if (params.selectionText) {
      template.push({ label: "复制", role: "copy" }, { type: "separator" });
    }
    template.push(
      { label: "后退", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: "前进", enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: "刷新", click: () => wc.reload() },
      { type: "separator" },
      { label: "复制当前页面地址", click: () => clipboard.writeText(wc.getURL()) },
        { label: "在系统浏览器中打开", enabled: /^https?:\/\//i.test(wc.getURL()), click: () => openSafeExternalUrl(wc.getURL()) }
    );
    Menu.buildFromTemplate(template).popup({ window: currentWindow });
  });
  wc.on("did-create-window", (child) => {
    const childId = child.webContents.id;
    popupTabs.set(childId, tab.id);
    child.on("closed", () => popupTabs.delete(childId));
  });
  wc.on("destroyed", () => sendTabsState());

  wc.loadURL(normalizeUrl(url || "about:blank"));
  if (activate) {
    if (activeId !== tab.id) stopFillTask(activeId, "标签页已切换，填写已停止");
    activeId = tab.id;
    attach(tab);
  }
  sendTabsState();
  return tab;
}

function closeTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  stopFillTask(id, "标签页已关闭，填写已停止");
  const [tab] = tabs.splice(index, 1);
  if (attachedView === tab.view) detach();
  lastAiFilled.delete(id);
  pendingPlans.delete(id);
  pendingLogins.delete(id);
  loginStates.delete(id);
  tab.view.webContents.close();
  if (activeId === id) {
    const next = tabs[index] || tabs[index - 1] || null;
    if (next) {
      activeId = next.id;
      attach(next);
    } else {
      activeId = null;
      createTab("about:blank");
      return;
    }
  }
  sendTabsState();
}

function switchTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (activeId !== id) stopFillTask(activeId, "标签页已切换，填写已停止");
  activeId = id;
  attach(tab);
  sendTabsState();
}

function withActive(fn) {
  const tab = activeTab();
  if (!tab) return undefined;
  return fn(tab.view.webContents, tab);
}

// Every frame in the page, main frame first. Cross-origin frames are fine:
// this runs with main-process privilege, not from the page.
function allFrames(wc) {
  const main = wc.mainFrame;
  return [main, ...main.framesInSubtree.filter((f) => f !== main)];
}

async function installUserEditTrackers(wc) {
  for (const frame of allFrames(wc)) {
    await frame.executeJavaScript(`(${trackUserEdits.toString()})()`).catch(() => {});
  }
}

async function scanAllFrames(wc) {
  const frames = allFrames(wc);
  const fields = [];
  const frameById = new Map();
  const run = Date.now().toString(36).slice(-4);
  for (let i = 0; i < frames.length; i++) {
    try {
      await frames[i].executeJavaScript(`(${trackUserEdits.toString()})()`);
      const found = await frames[i].executeJavaScript(`(${scanPageFields.toString()})(${JSON.stringify(`c${i}${run}-`)})`);
      for (const f of found || []) {
        frameById.set(f.id, frames[i]);
        fields.push(f);
      }
    } catch {
      // A frame that refuses scripts (sandboxed ad iframe, about:blank) has no form anyway.
    }
  }
  return { fields, frameById };
}

async function uploadResumeFiles(wc, filePath, stillOnPage = () => true) {
  let candidates = 0;
  for (const frame of allFrames(wc)) {
    if (!stillOnPage()) throw new Error("页面已切换，已停止上传简历");
    try {
      candidates += await frame.executeJavaScript(`(${markResumeFileInputs.toString()})()`);
    } catch {
      // inaccessible/disappearing frame
    }
  }
  if (!candidates) return 0;

  const dbg = wc.debugger;
  const ownedAttachment = !dbg.isAttached();
  if (ownedAttachment) dbg.attach("1.3");
  try {
    await dbg.sendCommand("DOM.enable");
    const { nodes } = await dbg.sendCommand("DOM.getFlattenedDocument", { depth: -1, pierce: true });
    const targets = (nodes || []).filter((node) => {
      if (node.nodeName !== "INPUT" || !node.backendNodeId) return false;
      const attrs = node.attributes || [];
      for (let i = 0; i < attrs.length; i += 2) {
        if (attrs[i] === "data-cp-resume-upload" && attrs[i + 1] === "1") return true;
      }
      return false;
    });
    let uploaded = 0;
    for (const node of targets) {
      if (!stillOnPage()) throw new Error("页面已切换，已停止上传简历");
      const { object } = await dbg.sendCommand("DOM.resolveNode", { backendNodeId: node.backendNodeId });
      const state = await dbg.sendCommand("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function () { return this.disabled || !!(this.files && this.files.length); }", returnByValue: true });
      if (state.result?.value !== false) continue;
      if (!stillOnPage()) throw new Error("页面已切换，已停止上传简历");
      await dbg.sendCommand("DOM.setFileInputFiles", { files: [filePath], backendNodeId: node.backendNodeId });
      uploaded++;
    }
    return uploaded;
  } finally {
    if (ownedAttachment && dbg.isAttached()) dbg.detach();
  }
}

// ---- multi-step form watcher ----
// 网申 wizards (基本信息 → 教育经历 → 实习 → 开放题) swap forms without a
// page load, so the "new form appeared" signal has to come from polling the
// active tab for a change in what's fillable. Signatures already filled or
// dismissed are remembered per tab so the hint doesn't nag.
const formWatch = { lastSignature: new Map(), settled: new Map(), timer: null };

async function checkForms() {
  const tab = activeTab();
  if (!tab || !lastBounds || tab.view.webContents.isLoading()) return;
  const wc = tab.view.webContents;
  let count = 0;
  const sigs = [];
  for (const frame of allFrames(wc)) {
    try {
      const r = await frame.executeJavaScript(`(${countFillableFields.toString()})(${scanPageFields.toString()})`);
      count += r.count;
      sigs.push(r.signature);
    } catch {
      // frame gone / scripts blocked
    }
  }
  const signature = sigs.join("||");
  if (signature === formWatch.lastSignature.get(tab.id)) return;
  formWatch.lastSignature.set(tab.id, signature);
  const settled = formWatch.settled.get(tab.id) || new Set();
  if (count >= 3 && !settled.has(signature)) {
    send("browser:form-detected", { tabId: tab.id, count, signature });
  }
}

async function checkApplicationSubmitted() {
  const tab = activeTab();
  if (!tab || tab.view.webContents.isLoading()) return;
  const wc = tab.view.webContents;
  let result = null;
  for (const frame of allFrames(wc)) {
    try {
      result = await frame.executeJavaScript(`(${detectApplicationSuccess.toString()})()`);
      if (result) break;
    } catch {
      // frame navigated or blocks script execution
    }
  }
  if (!result) return;
  const signature = `${result.url}|${result.evidence}`;
  if (submittedSignatures.get(tab.id) === signature) return;
  submittedSignatures.set(tab.id, signature);
  send("browser:application-submitted", { tabId: tab.id, ...result });
}

function markFormSettled(tabId, signature) {
  if (!formWatch.settled.has(tabId)) formWatch.settled.set(tabId, new Set());
  formWatch.settled.get(tabId).add(signature);
}

/**
 * Sets up the embedded 网申浏览器 panel: tabs of WebContentsViews layered on
 * top of the main window's own content, positioned by whatever bounds the
 * renderer reports for its placeholder div. Isolated from the main window's
 * own session (own partition) so it behaves like a real browser — logins on
 * job-application sites persist across restarts — but never shares any
 * bridge/preload with the arbitrary third-party pages it loads.
 */
// Where the extension is copied for Chrome to load: the home folder, because
// Chrome's "加载已解压的扩展程序" picker hides ~/Library (and Windows hides
// AppData), and Documents may be iCloud-evicted. Packaged builds carry a
// ready copy in Resources; a dev run builds one from extension/ on demand.
function chromeExtensionDir() {
  // Test runs use an isolated data folder and must not touch the real home.
  if (process.env.CAREERPLATFORM_TEST_MODE === "1") return path.join(app.getPath("userData"), "chrome-extension");
  return path.join(app.getPath("home"), "求职罗盘浏览器插件");
}

function syncChromeExtension({ force = false } = {}) {
  const target = chromeExtensionDir();
  let source = path.join(process.resourcesPath || "", "chrome-extension");
  if (!app.isPackaged || !fs.existsSync(source)) {
    source = require("../scripts/build-extension.cjs").buildExtension().outDir;
  }
  const version = (dir) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version;
    } catch {
      return null;
    }
  };
  // Refresh only when asked, or when an existing copy is from an older app —
  // never create one the applicant didn't ask for.
  if (force || (fs.existsSync(target) && version(target) !== version(source))) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
  }
  return target;
}

function setupBrowserViewIpc(mainWindow, serverPort) {
  currentWindow = mainWindow;
  port = serverPort;
  // A fresh window never has a view attached yet, even if a previous
  // window did — that attachment died with the old window.
  attachedView = null;
  if (registered) return;
  registered = true;

  const handle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
    assertTrustedBrowserEvent(event, currentWindow, `http://localhost:${port}`);
    return handler(event, ...args);
  });

  const browserSession = session.fromPartition(PARTITION);
  // 网申 sites hand out 测评说明/offer letters as downloads. Save straight
  // to ~/Downloads (no dialog — the page is already inside a panel) and tell
  // the renderer where it went.
  browserSession.on("will-download", (_event, item) => {
    const dir = app.getPath("downloads");
    const filename = safeDownloadFilename(item.getFilename());
    let target = path.join(dir, filename);
    let n = 1;
    while (fs.existsSync(target)) {
      const ext = path.extname(filename);
      target = path.join(dir, `${path.basename(filename, ext)} (${n++})${ext}`);
    }
    item.setSavePath(target);
    item.once("done", (_e, state) => {
      send("browser:download", { state, filename: path.basename(target), path: target });
    });
  });

  // ---- tabs & navigation ----
  handle("browser:new-tab", (_e, url) => createTab(url || "about:blank").id);
  handle("browser:switch-tab", (_e, id) => switchTab(id));
  handle("browser:close-tab", (_e, id) => closeTab(id));
  handle("browser:get-tabs", () => ({ tabs: tabs.map(tabState), activeId }));
  handle("browser:navigate", (_e, url) => {
    const tab = activeTab();
    if (tab) tab.view.webContents.loadURL(normalizeUrl(url));
    else createTab(url);
  });
  handle("browser:back", () => withActive((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()));
  handle("browser:forward", () => withActive((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()));
  handle("browser:reload", () => withActive((wc) => wc.reload()));
  handle("browser:stop", () => withActive((wc) => wc.stop()));
  handle("browser:zoom-in", () =>
    withActive((wc) => {
      wc.setZoomFactor(Math.min(wc.getZoomFactor() + ZOOM_STEP, ZOOM_MAX));
      sendTabsState();
    })
  );
  handle("browser:zoom-out", () =>
    withActive((wc) => {
      wc.setZoomFactor(Math.max(wc.getZoomFactor() - ZOOM_STEP, ZOOM_MIN));
      sendTabsState();
    })
  );
  handle("browser:zoom-reset", () =>
    withActive((wc) => {
      wc.setZoomFactor(1);
      sendTabsState();
    })
  );
  handle("browser:open-external", () => withActive((wc) => openSafeExternalUrl(wc.getURL())));
  handle("browser:copy-url", () => withActive((wc) => clipboard.writeText(wc.getURL())));
  // Copy buttons in the App's panels: the page view has the focus, so the
  // renderer's navigator.clipboard is refused there.
  handle("browser:copy-text", (_e, text) => {
    if (typeof text !== "string" || text.length > 200000) throw new Error("复制的内容不对");
    clipboard.writeText(text);
  });
  handle("browser:history", () => readHistory());
  handle("browser:clear-history", () => {
    fs.rmSync(historyFile(), { force: true });
  });
  handle("browser:show-download", (_e, file) => shell.showItemInFolder(file));
  // Logging out of every 网申 site at once — for switching accounts, or
  // just not leaving a term's worth of sessions lying around.
  handle("browser:clear-site-data", async () => {
    await browserSession.clearStorageData();
    await browserSession.clearCache();
    for (const t of tabs) t.view.webContents.reload();
  });

  // ---- saved passwords ----
  // From the pages (browser-guest-preload.js): only a tab's own frames and
  // its pop-ups are listened to; the site is taken from the frame that
  // sent it, never from what the page says.
  ipcMain.on("browser-guest:login", (event, payload) => {
    const tab = tabForSender(event.sender);
    const frameUrl = event.senderFrame && event.senderFrame.url;
    const realm = frameUrl ? loginRealm(frameUrl) : null;
    if (!tab || !realm || !payload || typeof payload !== "object") return;
    const username = typeof payload.username === "string" ? payload.username.trim().slice(0, 200) : "";
    const password = typeof payload.password === "string" ? payload.password.slice(0, 500) : "";
    if (!password) return;
    try {
      const store = logins();
      if (store.isNever(realm)) return;
      const status = store.status(realm, username, password);
      if (status === "same") return;
      pendingLogins.set(tab.id, { realm, username, password, at: Date.now() });
      send("browser:login-offer", { tabId: tab.id, site: realmLabel(realm), username, update: status === "changed" });
    } catch (error) {
      console.error("[saved-logins] could not check a login", error.message);
    }
  });
  ipcMain.on("browser-guest:login-form", async (event) => {
    const tab = tabForSender(event.sender);
    const frame = event.senderFrame;
    const realm = frame ? loginRealm(frame.url) : null;
    if (!tab || !realm) return;
    try {
      const store = logins();
      const accounts = store.forRealm(realm).map(({ id, username }) => ({ id, username }));
      const nearby = store.nearby(realm).map(({ id, username, site }) => ({ id, username, site }));
      let filled = null;
      // One kept account for this site and an empty form: fill it, like Chrome.
      if (accounts.length === 1 && autoFillAllowed(frame.url)) {
        const login = store.get(accounts[0].id);
        if (login) {
          const result = await frame.executeJavaScript(`(${fillLoginFields.toString()})(${JSON.stringify(login.username)}, ${JSON.stringify(login.password)}, false)`).catch(() => null);
          if (result && result.filled) {
            filled = login.username;
            store.touch(login.id);
          }
        }
      }
      // Like Chrome, the key icon only shows when there is something to fill.
      sendLoginState(tab, accounts.length || nearby.length ? { site: realmLabel(realm), realm, accounts, nearby, filled } : null);
    } catch (error) {
      console.error("[saved-logins] could not offer a login", error.message);
    }
  });
  handle("browser:login-state", (_e, tabId) => loginStates.get(tabId) || null);
  handle("browser:login-save", (_e, tabId) => {
    const pending = pendingLogins.get(tabId);
    if (!pending || Date.now() - pending.at > 10 * 60 * 1000) {
      pendingLogins.delete(tabId);
      return { ok: false, message: "这次登录的信息已过期，请重新登录后再保存" };
    }
    pendingLogins.delete(tabId);
    logins().save(pending.realm, pending.username, pending.password);
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      const store = logins();
      sendLoginState(tab, { site: realmLabel(pending.realm), realm: pending.realm, accounts: store.forRealm(pending.realm).map(({ id, username }) => ({ id, username })), nearby: [], filled: null });
    }
    return { ok: true, site: realmLabel(pending.realm) };
  });
  handle("browser:login-dismiss", (_e, tabId) => {
    pendingLogins.delete(tabId);
  });
  handle("browser:login-never", (_e, tabId) => {
    const pending = pendingLogins.get(tabId);
    pendingLogins.delete(tabId);
    if (pending) logins().addNever(pending.realm);
    return { ok: !!pending };
  });
  // The applicant picked an account from the key icon: fill it on this
  // tab's login form of that site (or the same host, for 「其他账号」).
  handle("browser:login-fill", async (_e, tabId, loginId) => {
    const tab = tabs.find((t) => t.id === tabId);
    const login = typeof loginId === "string" ? logins().get(loginId) : null;
    if (!tab || !login) return { ok: false, message: "这个账号已经删除了" };
    const frames = await loginFramesFor(tab, login.realm, true);
    for (const frame of frames) {
      const result = await frame.executeJavaScript(`(${fillLoginFields.toString()})(${JSON.stringify(login.username)}, ${JSON.stringify(login.password)}, true)`).catch(() => null);
      if (result && result.filled) {
        logins().touch(login.id);
        return { ok: true, username: login.username };
      }
    }
    return { ok: false, message: "这页没有找到这个网站的登录框" };
  });
  handle("browser:logins", () => {
    const store = logins();
    return { logins: store.list(), never: store.neverList() };
  });
  // Showing a kept password asks for the Mac's Touch ID first where there is
  // one, as Chrome asks for the system password.
  handle("browser:login-reveal", async (_e, id) => {
    const login = typeof id === "string" ? logins().get(id) : null;
    if (!login) return { ok: false, message: "这个账号已经删除了" };
    const { systemPreferences } = require("electron");
    if (process.platform === "darwin" && process.env.CAREERPLATFORM_TEST_MODE !== "1" && systemPreferences.canPromptTouchID()) {
      try {
        await systemPreferences.promptTouchID(`查看 ${login.site} 保存的密码`);
      } catch {
        return { ok: false, message: "没有通过验证，密码未显示" };
      }
    }
    return { ok: true, password: login.password };
  });
  handle("browser:login-copy", (_e, id) => {
    const login = typeof id === "string" ? logins().get(id) : null;
    if (!login) return { ok: false, message: "这个账号已经删除了" };
    clipboard.writeText(login.password);
    // Not left on the clipboard for long.
    setTimeout(() => { if (clipboard.readText() === login.password) clipboard.writeText(""); }, 60 * 1000);
    return { ok: true };
  });
  handle("browser:login-delete", (_e, id) => {
    const removed = typeof id === "string" && logins().remove(id);
    for (const [tabId, state] of loginStates) {
      if (state && state.accounts.some((account) => account.id === id)) {
        const tab = tabs.find((t) => t.id === tabId);
        if (tab) sendLoginState(tab, { ...state, accounts: state.accounts.filter((account) => account.id !== id), filled: null });
      }
    }
    return { ok: removed };
  });
  handle("browser:login-never-remove", (_e, realm) => {
    if (typeof realm === "string") logins().removeNever(realm);
  });

  // ---- find in page ----
  handle("browser:find", async (_e, { text, forward = true, findNext = false }) => {
    const tab = activeTab();
    if (!tab) return { active: 0, total: 0 };
    const result = await tab.view.webContents
      .executeJavaScript(`(${findInPageText.toString()})(${JSON.stringify(text)}, ${!!forward}, ${!findNext})`)
      .catch(() => ({ active: 0, total: 0 }));
    send("browser:find-result", { tabId: tab.id, active: result.active, total: result.total });
    return result;
  });
  handle("browser:find-stop", () =>
    withActive((wc) => wc.executeJavaScript(`(${findInPageText.toString()})("", true, true)`).catch(() => {}))
  );

  handle("browser:set-bounds", (e, rect) => {
    if (!rect) {
      lastBounds = null;
      detach();
      return;
    }
    // The page measures in CSS pixels; the window places views in its own.
    // They differ by the app's zoom (⌘+/⌘−, or fitting a narrow window).
    const zoom = e.sender.getZoomFactor() || 1;
    lastBounds = {
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
      width: Math.round(rect.width * zoom),
      height: Math.round(rect.height * zoom),
    };
    const tab = activeTab() || createTab("about:blank");
    attach(tab);
  });

  handle("browser:capture-page", async () => {
    const tab = activeTab();
    if (!tab) return { url: "", title: "", text: "" };
    const wc = tab.view.webContents;
    const text = await wc.executeJavaScript(`(${capturePageText.toString()})()`);
    return { url: wc.getURL(), title: wc.getTitle(), text };
  });

  // Full-page-visible screenshot of the current tab as a PNG data URL —
  // the renderer posts it to the Next server to file as an attachment
  // (投递成功页 proof, 测评 instructions).
  // 导出表单结构: one self-contained HTML file in Downloads with each frame's
  // redacted DOM plus how the matcher classified every field — enough to
  // rebuild the page as a fixture without anyone's personal details.
  handle("browser:export-form-structure", async () => {
    const tab = activeTab();
    if (!tab) throw new Error("没有打开的页面");
    const wc = tab.view.webContents;
    const pageUrl = wc.getURL();
    const profileRes = await fetch(`http://localhost:${port}/api/desktop-browser/profile?contextKey=${encodeURIComponent(portalContext(pageUrl))}`);
    const profile = profileRes.ok ? await profileRes.json() : {};
    const secrets = profileSecrets(profile);
    const { fields } = await scanAllFrames(wc);
    const rowIndexes = new Map();
    const scan = fields.map((field) => {
      const repeat = resolveRepeatField(field, rowIndexes);
      return { id: field.id, tag: field.tag, type: field.type, label: field.label, placeholder: field.placeholder, name: field.name, section: field.section, options: field.options, hasValue: field.hasValue, matched: repeat ? `${repeat.group}:${repeat.kind}#${repeat.row}${repeat.degreeHint ? ` 学历层级${repeat.degreeHint}` : ""}` : null };
    });
    const frames = [];
    for (const frame of allFrames(wc)) {
      const snapshot = await frame.executeJavaScript(`(${snapshotFormStructure.toString()})(${JSON.stringify(secrets)})`).catch(() => null);
      if (snapshot && snapshot.html.trim()) frames.push(snapshot);
    }
    const scrub = (text) => secrets.reduce((out, needle) => out.split(needle).join("[已隐藏]"), String(text || ""));
    const safeJson = scrub(JSON.stringify({ exportedAt: new Date().toISOString(), page: new URL(pageUrl).origin + new URL(pageUrl).pathname, fields: scan }, null, 2)).replace(/</g, "\\u003c");
    const html = `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><title>表单结构 · ${scrub(wc.getTitle()).replace(/</g, "&lt;")}</title></head><body>\n` +
      `<!-- 求职罗盘导出的网申表单结构：已去掉填写内容、个人资料、链接和图片，可放心发给开发者排查填写问题。 -->\n` +
      `<script type="application/json" id="cp-scan">${safeJson}</script>\n` +
      frames.map((frame, index) => `<section data-frame="${index}" data-url="${frame.url.replace(/"/g, "&quot;")}">\n${frame.html}\n</section>`).join("\n") +
      "\n</body></html>\n";
    const host = new URL(pageUrl).hostname.replace(/[^\w.-]/g, "_");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const file = path.join(app.getPath("downloads"), `网申表单结构-${host}-${stamp}.html`);
    fs.writeFileSync(file, html, "utf8");
    shell.showItemInFolder(file);
    return { path: file, fields: scan.length, frames: frames.length };
  });

  // 定制简历 export. The page is our own escaped template, but it is still
  // rendered with JavaScript off in a throwaway hidden window, then printed
  // to A4 PDF (or written as a Word-readable .doc) into Downloads.
  handle("browser:export-document", async (_e, { format, html, fileName }) => {
    if (!["pdf", "doc"].includes(format)) throw new Error("不支持的导出格式");
    if (typeof html !== "string" || html.length > 2000000) throw new Error("导出内容过大");
    const base = safeDownloadFilename(String(fileName || "定制简历").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "定制简历");
    const file = path.join(app.getPath("downloads"), `${base}.${format}`);
    if (format === "doc") {
      fs.writeFileSync(file, html, "utf8");
    } else {
      const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true, partition: "cp-document-export" } });
      try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        const pdf = await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
        fs.writeFileSync(file, pdf);
      } finally {
        win.destroy();
      }
    }
    shell.showItemInFolder(file);
    return { path: file };
  });

  // Settings → 浏览器插件: put an unpacked copy of the extension in a stable,
  // visible folder Chrome can keep loading across app updates, and show it,
  // for chrome://extensions → 加载已解压的扩展程序.
  // 小欧's 「填进这一栏」: one drafted answer into the page box with that
  // question. A box already holding text is only replaced when asked.
  handle("browser:fill-field", async (_e, label, value, overwrite = false) => {
    const tab = activeTab();
    if (!tab) throw new Error("先打开网申页面");
    if (typeof label !== "string" || typeof value !== "string" || !value.trim() || value.length > 20000) throw new Error("回答内容不对");
    const { fields, frameById } = await scanAllFrames(tab.view.webContents);
    const norm = (text) => String(text || "").normalize("NFKC").replace(/[\s*＊:：?？。.，,、（）()「」“”"'【】\[\]]/g, "").toLowerCase();
    const want = norm(label);
    const boxes = fields.filter((field) => ["input", "textarea", "richtext"].includes(field.tag) && !field.options && !["date", "month", "number", "email", "tel"].includes(field.type));
    const field = boxes.find((item) => norm(item.label) === want)
      || boxes.find((item) => { const own = norm(item.label); return own.length >= 6 && (own.includes(want.slice(0, 24)) || want.includes(own)); });
    if (!field) return { ok: false, reason: "没在页面上找到这道题，可能换页了；可以复制后自己粘贴" };
    if (field.hasValue && !overwrite) return { ok: false, needsConfirm: true };
    const frame = frameById.get(field.id);
    if (field.hasValue) {
      await frame.executeJavaScript(`(() => { const el = document.querySelector('[data-cp-fill-id="${field.id}"]'); if (!el) return; el.removeAttribute("data-cp-user-edited"); const setter = Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value"); if (setter && "value" in el) { setter.set.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); } else if (el.isContentEditable) { el.textContent = ""; } })()`).catch(() => {});
    }
    const result = await frame.executeJavaScript(`(${fillFields.toString()})(${JSON.stringify([{ id: field.id, value, source: "ai", label: field.label, tag: field.tag }])})`);
    await frame.executeJavaScript(`(${focusFormField.toString()})(${JSON.stringify(field.id)})`).catch(() => {});
    return { ok: !!result?.filled?.includes(field.id), reason: result?.filled?.includes(field.id) ? undefined : "这一栏没填进去，可以复制后自己粘贴" };
  });

  handle("browser:fill-stats", () => {
    const dir = sampleDir();
    let stats = {};
    try { stats = JSON.parse(fs.readFileSync(path.join(dir, "填写统计.json"), "utf8")) || {}; } catch { stats = {}; }
    let samples = 0;
    try { samples = fs.readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "填写统计.json").length; } catch { samples = 0; }
    return { stats, samples };
  });
  handle("browser:open-samples", () => {
    const dir = sampleDir();
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  handle("browser:open-extension-folder", () => {
    const dir = syncChromeExtension({ force: true });
    // The picker's "go to folder" (⌘⇧G / address bar) takes a pasted path.
    clipboard.writeText(dir);
    shell.openPath(dir);
    return { path: dir };
  });

  // Settings → 自动备份's folder picker. Lives on this trusted bridge because
  // it is the one already restricted to the app's own main frame.
  handle("browser:choose-directory", async () => {
    const options = { title: "选择自动备份文件夹", properties: ["openDirectory", "createDirectory"] };
    const result = currentWindow && !currentWindow.isDestroyed() ? await dialog.showOpenDialog(currentWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] || null;
  });

  // A still of the page for the App to show while its own menus or dialogs
  // are open: the page itself is a native layer drawn above the App and
  // would cover them, so it steps aside and this picture stands in for it.
  handle("browser:preview-frame", async () => {
    const tab = activeTab();
    if (!tab || !attachedView || attachedView !== tab.view || tab.view.webContents.isDestroyed()) return null;
    const image = await tab.view.webContents.capturePage().catch(() => null);
    if (!image || image.isEmpty()) return null;
    return `data:image/jpeg;base64,${image.toJPEG(82).toString("base64")}`;
  });

  handle("browser:screenshot", async () => {
    const tab = activeTab();
    if (!tab) throw new Error("没有打开的页面");
    const image = await tab.view.webContents.capturePage();
    return { dataUrl: image.toDataURL(), url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle() };
  });

  handle("browser:form-dismiss", (_e, { tabId, signature }) => markFormSettled(tabId, signature));
  if (!formWatch.timer) formWatch.timer = setInterval(() => {
    checkForms().catch(() => {});
    checkApplicationSubmitted().catch(() => {});
  }, 2500);

  handle("browser:clear-marks", async () => {
    const tab = activeTab();
    if (!tab) return;
    for (const frame of allFrames(tab.view.webContents)) {
      await frame.executeJavaScript(`(${clearFillMarks.toString()})()`).catch(() => {});
    }
  });

  // The autofill flow itself lives in autofill-core.js (shared with the
  // Chrome extension); this adapter is everything Electron-specific about it.
  function electronAdapter(tab, task) {
    const wc = tab.view.webContents;
    const revision = tab.revision;
    const isActive = (url) => !wc.isDestroyed() && wc.getURL() === url && activeId === tab.id && revision === tab.revision && !task?.controller.signal.aborted;
    return {
      url: () => wc.getURL(),
      stillOnPage: isActive,
      taskId: task?.id,
      stopReason: () => task?.reason,
      frames: async () => allFrames(wc),
      run: (frame, fn, args = []) => frame.executeJavaScript(`(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`),
      api: (name, init) => fetch(`http://localhost:${port}/api/desktop-browser/${name}`, { ...init, signal: task?.controller.signal }),
      status: (payload) => send("browser:autofill-status", { ...payload, tabId: tab.id }),
      uploadResume: async (resumeVersionId) => {
        const initialUrl = wc.getURL();
        const stillOnPage = () => isActive(initialUrl);
        const fileRes = await fetch(`http://localhost:${port}/api/desktop-browser/resume-file?resumeVersionId=${encodeURIComponent(resumeVersionId)}`, { signal: task?.controller.signal });
        if (!fileRes.ok) throw new Error((await fileRes.json().catch(() => ({}))).error || "简历附件上传失败");
        const file = await fileRes.json();
        if (!stillOnPage()) throw new Error("页面已切换，已停止上传简历");
        return uploadResumeFiles(wc, file.path, stillOnPage);
      },
      jobId: () => tab.positionId,
      archiveScope: () => tab.positionId ? `job:v1:${tab.positionId}` : portalContext(tab.archiveUrl || wc.getURL()),
      getPlan: () => { const plan = pendingPlans.get(tab.id); return plan?.revision === tab.revision ? plan : null; },
      setPlan: (plan) => plan ? pendingPlans.set(tab.id, { ...plan, revision: tab.revision }) : pendingPlans.delete(tab.id),
      getDrafts: () => lastAiFilled.get(tab.id) || [],
      getDraftSignature: () => tab.draftSignature,
      setDraftSignature: (signature) => { tab.draftSignature = signature; },
      setDrafts: (list) => lastAiFilled.set(tab.id, list),
      // Whatever this page looked like, it's handled — don't re-prompt for it.
      onFilled: async () => {
        for (const frame of allFrames(wc)) {
          const r = await frame.executeJavaScript(`(${countFillableFields.toString()})(${scanPageFields.toString()})`).catch(() => null);
          if (r) markFormSettled(tab.id, r.signature);
        }
        formWatch.lastSignature.delete(tab.id);
      },
    };
  }

  // `options.expandBlocks`: when the profile has more 教育/实习/项目 rows than
  // the page shows, press the page's own 添加 button and fill again (see
  // runAutofillCore). `options.variantId`: 网申资料方案.
  handle("browser:autofill", async (_e, resumeVersionId, options) => {
    const tab = activeTab();
    if (!tab) return;
    if (fillingTabs.has(tab.id)) return;
    fillingTabs.add(tab.id);
    const task = { id: crypto.randomUUID(), controller: new AbortController(), reason: null };
    fillTasks.set(tab.id, task);
    try {
      for (const frame of allFrames(tab.view.webContents)) await frame.executeJavaScript(`document.documentElement.setAttribute("data-cp-task", ${JSON.stringify(task.id)})`).catch(() => {});
      if (options?.mode === "apply") await applyAutofillPlan(electronAdapter(tab, task), options);
      else { tab.archiveUrl = tab.view.webContents.getURL(); tab.positionId = options?.positionId; tab.resumeVersionId = resumeVersionId; tab.variantId = options?.variantId; const result = await runAutofillCore(electronAdapter(tab, task), resumeVersionId, options || {});
        if (result?.phase === "done" && result.summary) { tab.filledAt = Date.now(); recordFillStats(tab.archiveUrl, { fills: 1, filled: result.summary.filled || 0, manual: result.summary.manual || 0 }); } }
    } finally { fillingTabs.delete(tab.id); fillTasks.delete(tab.id); }
  });

  handle("browser:focus-field", async (_e, id) => {
    const tab = activeTab(); if (!tab || typeof id !== "string") return;
    for (const frame of allFrames(tab.view.webContents)) if (await frame.executeJavaScript(`(${focusFormField.toString()})(${JSON.stringify(id)})`).catch(() => false)) break;
  });
  handle("browser:application-snapshot", async () => {
    const tab = activeTab(); if (!tab) return null;
    const wc = tab.view.webContents;
    const fields = [];
    for (const frame of allFrames(wc)) {
      await frame.executeJavaScript(`(${readCurrentApplicationFields.toString()})()`).catch(() => {});
      fields.push(...((await frame.executeJavaScript(`(${collectApplicationFields.toString()})(${JSON.stringify(tab.positionId ? `job:v1:${tab.positionId}` : portalContext(tab.archiveUrl || wc.getURL()))})`).catch(() => [])) || []));
    }
    // What the tab went through before the success page — the job page's
    // title usually names both the role and the employer — for working out
    // which application this was.
    const history = wc.navigationHistory.getAllEntries().slice(0, wc.navigationHistory.getActiveIndex() + 1)
      .filter((entry) => /^https?:/i.test(entry.url)).slice(-15).map((entry) => ({ url: entry.url.slice(0, 2000), title: String(entry.title || "").slice(0, 300) }));
    const page = await wc.executeJavaScript(`(() => ({ text: (${capturePageText.toString()})().slice(0, 4000), siteName: (document.querySelector('meta[property="og:site_name"], meta[name="application-name"]') || {}).content || "" }))()`).catch(() => ({ text: "", siteName: "" }));
    return { fields, url: wc.getURL(), title: wc.getTitle(), text: page.text, siteName: String(page.siteName || "").slice(0, 100), history, positionId: tab.positionId, resumeVersionId: tab.resumeVersionId, variantId: tab.variantId };
  });
  handle("browser:cancel-autofill", (_e, tabId) => stopFillTask(tabId ?? activeId));

  // Remember manually entered facts and essays; never save untouched drafts.
  // 「这页没填好」: the current page's form structure, what the applicant wrote
  // taken out, saved as a file they can send so the problem can be reproduced.
  handle("browser:capture-sample", async (_e, note) => {
    const tab = activeTab();
    if (!tab) throw new Error("先打开一个网申页面");
    const result = await captureSample(tab, note);
    if (process.env.CAREERPLATFORM_TEST_MODE !== "1") shell.showItemInFolder(result.file);
    return result;
  });

  handle("browser:save-corrections", async (_e, resumeVersionId, onlyUserEdited = false, positionId, variantId, discover = true) => {
    const tab = activeTab();
    if (!tab) return { saved: 0 };
    if (typeof positionId === "string") tab.positionId = positionId || undefined;
    if (savingAnswersForTabs.has(tab.id)) return { saved: 0 };
    savingAnswersForTabs.add(tab.id);
    try {
      const result = await saveCorrectionsCore(electronAdapter(tab), resumeVersionId, onlyUserEdited, variantId ?? tab.variantId, discover !== false);
      // Several boxes typed by hand after 一键填写 = boxes it missed: keep the
      // page's structure (never the values) so the next round can fix them.
      if (result.handTyped >= AUTO_SAMPLE_TYPED && tab.filledAt && Date.now() - tab.filledAt < 6 * 3_600_000) {
        captureSample(tab, `自动保存：一键填写后手填了 ${result.handTyped} 个字段`, { auto: true }).catch(() => {});
      }
      if (result.handTyped) recordFillStats(tab.view.webContents.getURL(), { typed: result.handTyped });
      return result;
    } finally {
      savingAnswersForTabs.delete(tab.id);
    }
  });
}

// 网申样本: form structures saved for fixing autofill — by 「这页没填好」 or
// by themselves when a filled page still needed several boxes typed in.
const AUTO_SAMPLE_TYPED = 3;
const AUTO_SAMPLE_LIMIT = 120;
const sampleDir = () => path.join(app.getPath("userData"), "网申样本");

async function captureSample(tab, note, { auto = false } = {}) {
  const wc = tab.view.webContents;
  let page;
  try { const url = new URL(wc.getURL()); page = `${url.origin}${url.pathname}`; } catch { throw new Error("先打开一个网申页面"); }
  const dir = sampleDir();
  const host = new URL(page).hostname;
  const day = new Date().toISOString().slice(0, 10);
  // One automatic sample per page a day; a click on 「这页没填好」 always saves.
  const key = crypto.createHash("sha1").update(page).digest("hex").slice(0, 8);
  if (auto && fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.startsWith(`auto-${day}-${host}-${key}`))) return { file: "", fields: 0, skipped: true };
  const frames = [];
  for (const frame of allFrames(wc)) {
    try {
      const fields = await frame.executeJavaScript(`(${scanPageFields.toString()})("s-", true)`);
      const html = await frame.executeJavaScript(`(${formSkeleton.toString()})()`);
      let frameUrl = "";
      try { const u = new URL(frame.url); frameUrl = `${u.origin}${u.pathname}`; } catch { /* about:blank */ }
      frames.push({
        url: frameUrl,
        // Labels and structure only: no current values or saved entries.
        fields: (fields || []).map((f) => ({ tag: f.tag, type: f.type, label: f.label, placeholder: f.placeholder, name: f.name, section: f.section, options: f.options, required: f.required, maxLength: f.maxLength, hadValue: !!f.hasValue, savedEntries: f.savedEntries ? f.savedEntries.length : 0, blockKey: f.blockKey ? "yes" : undefined })),
        html,
      });
    } catch { /* A frame that refuses scripts has no form to show. */ }
  }
  if (!frames.some((frame) => frame.fields.length)) throw new Error("这个页面上没找到表单");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, auto ? `auto-${day}-${host}-${key}.json` : `${host}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ app: app.getVersion(), page, title: wc.getTitle(), capturedAt: new Date().toISOString(), auto, note: typeof note === "string" ? note.slice(0, 1000) : "", frames }, null, 1));
  if (auto) {
    const autos = fs.readdirSync(dir).filter((name) => name.startsWith("auto-")).sort();
    for (const name of autos.slice(0, Math.max(0, autos.length - AUTO_SAMPLE_LIMIT))) fs.rmSync(path.join(dir, name), { force: true });
    recordFillStats(page, { samples: 1 });
  }
  return { file, fields: frames.reduce((sum, frame) => sum + frame.fields.length, 0) };
}

/** Per-site counts (填写统计.json): how much 一键填写 filled and how much was still typed by hand. */
function recordFillStats(rawUrl, patch) {
  try {
    const host = new URL(rawUrl).hostname;
    if (!host) return;
    const dir = sampleDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "填写统计.json");
    let stats = {};
    try { stats = JSON.parse(fs.readFileSync(file, "utf8")) || {}; } catch { stats = {}; }
    const row = stats[host] || { fills: 0, filled: 0, manual: 0, typed: 0, samples: 0 };
    for (const [key, value] of Object.entries(patch)) row[key] = (row[key] || 0) + value;
    row.lastAt = new Date().toISOString();
    stats[host] = row;
    fs.writeFileSync(file, JSON.stringify(stats, null, 1));
  } catch { /* Statistics never get in the way of filling. */ }
}

module.exports = { setupBrowserViewIpc, syncChromeExtension };
