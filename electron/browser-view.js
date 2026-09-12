const { ipcMain, WebContentsView, Menu, session, shell, app, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");

// Pure, self-contained functions — these get stringified and injected into
// the visited page (every frame of it) via executeJavaScript, so they can't
// close over anything from this module. Keep them free of outside references.

// `prefix` namespaces the field ids per frame: 网申 forms on 北森/Moka-style
// portals commonly live inside an iframe, and ids must stay unique across
// all frames so the fill step can route each value back to the right one.
function scanPageFields(prefix) {
  const results = [];
  let counter = 0;
  const seenRadioGroups = new Set();
  const elements = document.querySelectorAll(
    'input[type="text"], input[type="tel"], input[type="email"], input[type="number"], input[type="date"], input[type="month"], input[type="url"], input[type="radio"], input:not([type]), textarea, select'
  );

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  // Component-library forms (Ant Design, Element, and most Chinese
  // enterprise recruiting portals are built on one of these) put the input
  // several DOM levels below its label, as a sibling deep inside a shared
  // "form item" wrapper — a plain previous-sibling walk almost never finds
  // it. Walk up looking for that wrapper, then take the first text-bearing
  // node inside it that isn't the input itself.
  function labelFromFormItem(el) {
    let container = el.parentElement;
    let depth = 0;
    while (container && depth < 6) {
      const cls = (container.className || "").toString().toLowerCase();
      if (/form-item|form-group|field|form-row|input-group|form-cell|form-control-wrap|el-form/.test(cls)) {
        const explicit = container.querySelector("label, .ant-form-item-label, .el-form-item__label, [class*='label']");
        if (explicit && !explicit.contains(el)) {
          const text = (explicit.textContent || "").trim();
          if (text && text.length < 40) return text;
        }
        const candidates = container.querySelectorAll("label, span, div, p");
        for (const node of candidates) {
          if (node === el || node.contains(el) || el.contains(node)) continue;
          const text = (node.textContent || "").trim();
          if (text && text.length < 40) return text;
        }
      }
      container = container.parentElement;
      depth++;
    }
    return "";
  }

  // Table-layout forms (still common on older 官网 portals): the label is
  // the cell to the left.
  function labelFromTable(el) {
    const cell = el.closest("td");
    if (!cell) return "";
    let prev = cell.previousElementSibling;
    while (prev) {
      const text = (prev.textContent || "").trim();
      if (text && text.length < 40) return text;
      prev = prev.previousElementSibling;
    }
    return "";
  }

  function labelFor(el) {
    if (el.id) {
      const byFor = document.querySelector('label[for="' + el.id + '"]');
      if (byFor && byFor.textContent) return byFor.textContent.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping && wrapping.textContent) return wrapping.textContent.trim();
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    const ariaLabelledby = el.getAttribute("aria-labelledby");
    if (ariaLabelledby) {
      const ref = document.getElementById(ariaLabelledby);
      if (ref && ref.textContent) return ref.textContent.trim();
    }
    const fromFormItem = labelFromFormItem(el);
    if (fromFormItem) return fromFormItem;
    const fromTable = labelFromTable(el);
    if (fromTable) return fromTable;
    let node = el.previousElementSibling;
    let hops = 0;
    while (node && hops < 3) {
      const text = (node.textContent || "").trim();
      if (text) return text.slice(0, 60);
      node = node.previousElementSibling;
      hops++;
    }
    return "";
  }

  // 性别/政治面貌/是否服从调剂 are radio groups far more often than <select>s
  // on Chinese 网申 forms. One entry per group (by name), options = each
  // radio's own label, filled later by clicking the matching one.
  function radioGroup(el) {
    const name = el.getAttribute("name");
    if (!name || seenRadioGroups.has(name)) return null;
    seenRadioGroups.add(name);
    const scope = el.form || document;
    const radios = Array.from(scope.querySelectorAll('input[type="radio"]')).filter((r) => r.getAttribute("name") === name);
    const options = radios.map((r) => {
      const wrapping = r.closest("label");
      const text = wrapping ? wrapping.textContent : r.nextSibling && r.nextSibling.textContent;
      return (text || r.value || "").trim();
    });
    if (options.filter(Boolean).length < 2) return null;
    // The group's own label: the shared form item, or the text before the first radio.
    let label = labelFromFormItem(radios[0]) || labelFromTable(radios[0]);
    if (!label) {
      const container = radios[0].closest("div, fieldset, td, li");
      const legend = container && container.querySelector("legend");
      if (legend) label = legend.textContent.trim();
    }
    return { radios, options, label };
  }

  elements.forEach((el) => {
    if (el.type === "password" || el.disabled || el.readOnly || !isVisible(el)) return;
    if (el.type === "radio") {
      const group = radioGroup(el);
      if (!group) return;
      const id = prefix + "r" + counter++;
      group.radios.forEach((r, i) => r.setAttribute("data-cp-fill-id", id + ":" + i));
      results.push({ id, tag: "radio", type: "radio", label: group.label, placeholder: "", name: el.getAttribute("name") || "", options: group.options });
      return;
    }
    const id = prefix + "f" + counter++;
    el.setAttribute("data-cp-fill-id", id);
    const entry = {
      id,
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      label: labelFor(el),
      placeholder: el.getAttribute("placeholder") || "",
      name: el.getAttribute("name") || "",
      // Already has something in it — the user (or the site) filled it; the
      // autofill leaves those alone rather than overwriting.
      hasValue: !!(el.value && String(el.value).trim()),
    };
    if (entry.tag === "select") {
      entry.options = Array.from(el.options)
        .map((o) => (o.textContent || "").trim())
        .filter(Boolean);
    }
    results.push(entry);
  });

  return results;
}

// Visible text of the page the user is looking at, for "收藏这个岗位" —
// innerText (not textContent) so hidden nav menus, <script> bodies and
// collapsed panels don't drown the actual posting. Capped because job
// boards render huge sidebars of "recommended jobs" below the real JD.
function capturePageText() {
  const text = (document.body && document.body.innerText) || "";
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000);
}

// AI's honest "couldn't find this in the resume" answer for a short/choice
// field — distinct from a real value so it never gets written into the page
// (a sentence dropped into a 性别 dropdown would be worse than leaving it
// blank). Deliberately an unambiguous English sentinel, not matched against
// any wording the AI might naturally produce.
const NEEDS_MANUAL_INPUT = "NEEDS_MANUAL_INPUT";

function fillFields(pairs) {
  let filled = 0;
  // Most 网申 forms are React/Vue-controlled: writing `el.value = x` directly
  // gets silently ignored, because those frameworks override the native
  // value property's setter to track changes themselves — an event fired
  // after a raw assignment never reaches their internal state. Calling the
  // *native* prototype setter first, then dispatching input/change, is the
  // standard bypass (same trick browser automation tools use).
  const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;

  // Date inputs only accept ISO; profiles and resumes write dates every
  // which way (2003/5/1, 2003.05.01, 2003年5月1日). Normalise, and cut to
  // yyyy-MM for <input type=month>.
  function normalizeDate(value, type) {
    const m = String(value).match(/(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
    if (!m) return value;
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    const d = (m[3] || "01").padStart(2, "0");
    return type === "month" ? y + "-" + mo : y + "-" + mo + "-" + d;
  }

  // A visible marker on everything the autofill touched, so "提交前自己检查
  // 一遍" means scanning for purple outlines rather than re-reading the
  // whole form. Two tones: profile facts vs. AI-generated text.
  function mark(el, source) {
    el.setAttribute("data-cp-filled", source);
    el.style.setProperty("outline", (source === "ai" ? "2px solid #d946ef" : "2px solid #8b5cf6"), "important");
    el.style.setProperty("outline-offset", "1px", "important");
  }

  pairs.forEach((p) => {
    if (!p.value) return;
    if (/-r\d+$/.test(p.id)) {
      // radio group (ids are "<frame>-r<n>", fields are "<frame>-f<n>"):
      // click the option whose label matches
      const radios = Array.from(document.querySelectorAll('[data-cp-fill-id^="' + p.id + ':"]'));
      const target = radios.find((r) => {
        const wrapping = r.closest("label");
        const text = ((wrapping ? wrapping.textContent : r.nextSibling && r.nextSibling.textContent) || r.value || "").trim();
        return text === p.value;
      });
      if (!target) return;
      target.click();
      mark(target.closest("label") || target, p.source || "profile");
      filled++;
      return;
    }
    const el = document.querySelector('[data-cp-fill-id="' + p.id + '"]');
    if (!el) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const match = Array.from(el.options).find((o) => o.textContent.trim() === p.value);
      if (!match) return;
      el.value = match.value;
    } else if (tag === "textarea") {
      nativeTextareaSetter.call(el, p.value);
    } else if (el.type === "date" || el.type === "month") {
      nativeInputSetter.call(el, normalizeDate(p.value, el.type));
    } else {
      nativeInputSetter.call(el, p.value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    mark(el, p.source || "profile");
    filled++;
  });
  return filled;
}

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

function clearFillMarks() {
  document.querySelectorAll("[data-cp-filled]").forEach((el) => {
    el.style.removeProperty("outline");
    el.style.removeProperty("outline-offset");
    el.removeAttribute("data-cp-filled");
  });
}

// Read side of fillFields — same element lookup and same "select reads by
// visible option text" rule, so a value read back here compares cleanly
// against what fillFields originally wrote.
function readFieldValues(ids) {
  const result = {};
  ids.forEach((id) => {
    const el = document.querySelector('[data-cp-fill-id="' + id + '"]');
    if (!el) return;
    if (el.tagName.toLowerCase() === "select") {
      const selected = el.options[el.selectedIndex];
      result[id] = selected ? selected.textContent.trim() : "";
    } else {
      result[id] = el.value;
    }
  });
  return result;
}

// Runs in the main process, not injected — matches detected form fields to
// the user's own saved profile by keyword. Intentionally conservative: a
// field with no confident match is left for the AI pass (or manual entry)
// rather than guessed at here.
const BASIC_FIELD_RULES = [
  { keys: ["姓名", "真实姓名", "name"], get: (p) => p.name },
  { keys: ["手机", "电话", "联系电话", "phone", "mobile", "tel"], get: (p) => p.phone },
  { keys: ["邮箱", "email", "mail"], get: (p) => p.email },
  { keys: ["性别", "gender"], get: (p) => p.gender },
  { keys: ["出生日期", "出生年月", "生日", "birth"], get: (p) => p.birthDate },
  { keys: ["学校", "毕业院校", "院校", "school", "university"], get: (p) => p.school },
  {
    keys: ["毕业年份", "毕业时间", "graduate"],
    get: (p) => (p.graduationYear ? String(p.graduationYear) : ""),
  },
  { keys: ["意向城市", "期望城市", "工作城市", "city"], get: (p) => p.preferredCities },
];

// Never sent to AI, never guessed, always left for the user — a resume
// essentially never contains these, and getting one wrong (a fabricated ID
// number, a wrong bank digit) is a real-world problem, not just a bad fill.
// 同意/承诺 checkboxes and 验证码 fields are excluded for the obvious reason.
const NEVER_GUESS_KEYWORDS = [
  "身份证",
  "证件号码",
  "护照",
  "签名",
  "密码",
  "password",
  "验证码",
  "captcha",
  "银行卡",
  "卡号",
  "同意",
  "承诺",
];

function fieldHaystack(field) {
  return `${field.label} ${field.placeholder} ${field.name}`.toLowerCase();
}

function matchBasicField(field, profile) {
  const haystack = fieldHaystack(field);
  for (const rule of BASIC_FIELD_RULES) {
    if (rule.keys.some((k) => haystack.includes(k.toLowerCase()))) {
      const value = rule.get(profile);
      if (!value) continue;
      // A choice field still has to hit one of its own options exactly.
      if (field.options && !field.options.includes(value)) {
        const loose = field.options.find((o) => o.includes(value) || value.includes(o));
        if (!loose) continue;
        return loose;
      }
      return value;
    }
  }
  return null;
}

function isNeverGuessField(field) {
  const haystack = fieldHaystack(field);
  return NEVER_GUESS_KEYWORDS.some((k) => haystack.includes(k.toLowerCase()));
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

function send(channel, payload) {
  if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send(channel, payload);
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
  };
}

function sendTabsState() {
  send("browser:tabs", { tabs: tabs.map(tabState), activeId });
}

function attach(t) {
  if (!currentWindow || currentWindow.isDestroyed()) return;
  if (attachedView && attachedView !== t.view) {
    currentWindow.contentView.removeChildView(attachedView);
    attachedView = null;
  }
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
    },
  });
  view.setBackgroundColor("#ffffff");
  const tab = { id: nextTabId++, view };
  tabs.push(tab);
  const wc = view.webContents;

  wc.on("did-navigate", () => sendTabsState());
  wc.on("did-navigate-in-page", () => sendTabsState());
  wc.on("page-title-updated", () => {
    recordHistory(wc.getURL(), wc.getTitle());
    sendTabsState();
  });
  wc.on("did-start-loading", () => sendTabsState());
  wc.on("did-stop-loading", () => {
    recordHistory(wc.getURL(), wc.getTitle());
    sendTabsState();
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
    else send("browser:shortcut", { action: map[key], tabId: tab.id });
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
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: session.fromPartition(PARTITION) },
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
      { label: "在系统浏览器中打开", click: () => shell.openExternal(wc.getURL()) }
    );
    Menu.buildFromTemplate(template).popup({ window: currentWindow });
  });
  wc.on("destroyed", () => sendTabsState());

  wc.loadURL(normalizeUrl(url || "about:blank"));
  if (activate) {
    activeId = tab.id;
    attach(tab);
  }
  sendTabsState();
  return tab;
}

function closeTab(id) {
  const index = tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [tab] = tabs.splice(index, 1);
  if (attachedView === tab.view) detach();
  lastAiFilled.delete(id);
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

async function scanAllFrames(wc) {
  const frames = allFrames(wc);
  const fields = [];
  const frameById = new Map();
  for (let i = 0; i < frames.length; i++) {
    try {
      const found = await frames[i].executeJavaScript(`(${scanPageFields.toString()})(${JSON.stringify(`c${i}-`)})`);
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

async function fillAllFrames(pairs, frameById) {
  const byFrame = new Map();
  for (const p of pairs) {
    const frame = frameById.get(p.id);
    if (!frame) continue;
    if (!byFrame.has(frame)) byFrame.set(frame, []);
    byFrame.get(frame).push(p);
  }
  let filled = 0;
  for (const [frame, subset] of byFrame) {
    try {
      filled += await frame.executeJavaScript(`(${fillFields.toString()})(${JSON.stringify(subset)})`);
    } catch {
      // Frame navigated away between scan and fill.
    }
  }
  return filled;
}

/**
 * Sets up the embedded 网申浏览器 panel: tabs of WebContentsViews layered on
 * top of the main window's own content, positioned by whatever bounds the
 * renderer reports for its placeholder div. Isolated from the main window's
 * own session (own partition) so it behaves like a real browser — logins on
 * job-application sites persist across restarts — but never shares any
 * bridge/preload with the arbitrary third-party pages it loads.
 */
function setupBrowserViewIpc(mainWindow, serverPort) {
  currentWindow = mainWindow;
  port = serverPort;
  // A fresh window never has a view attached yet, even if a previous
  // window did — that attachment died with the old window.
  attachedView = null;
  if (registered) return;
  registered = true;

  const browserSession = session.fromPartition(PARTITION);
  // 网申 sites hand out 测评说明/offer letters as downloads. Save straight
  // to ~/Downloads (no dialog — the page is already inside a panel) and tell
  // the renderer where it went.
  browserSession.on("will-download", (_event, item) => {
    const dir = app.getPath("downloads");
    let target = path.join(dir, item.getFilename());
    let n = 1;
    while (fs.existsSync(target)) {
      const ext = path.extname(item.getFilename());
      target = path.join(dir, `${path.basename(item.getFilename(), ext)} (${n++})${ext}`);
    }
    item.setSavePath(target);
    item.once("done", (_e, state) => {
      send("browser:download", { state, filename: path.basename(target), path: target });
    });
  });

  // ---- tabs & navigation ----
  ipcMain.handle("browser:new-tab", (_e, url) => createTab(url || "about:blank").id);
  ipcMain.handle("browser:switch-tab", (_e, id) => switchTab(id));
  ipcMain.handle("browser:close-tab", (_e, id) => closeTab(id));
  ipcMain.handle("browser:get-tabs", () => ({ tabs: tabs.map(tabState), activeId }));
  ipcMain.handle("browser:navigate", (_e, url) => {
    const tab = activeTab();
    if (tab) tab.view.webContents.loadURL(normalizeUrl(url));
    else createTab(url);
  });
  ipcMain.handle("browser:back", () => withActive((wc) => wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack()));
  ipcMain.handle("browser:forward", () => withActive((wc) => wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward()));
  ipcMain.handle("browser:reload", () => withActive((wc) => wc.reload()));
  ipcMain.handle("browser:stop", () => withActive((wc) => wc.stop()));
  ipcMain.handle("browser:zoom-in", () =>
    withActive((wc) => {
      wc.setZoomFactor(Math.min(wc.getZoomFactor() + ZOOM_STEP, ZOOM_MAX));
      sendTabsState();
    })
  );
  ipcMain.handle("browser:zoom-out", () =>
    withActive((wc) => {
      wc.setZoomFactor(Math.max(wc.getZoomFactor() - ZOOM_STEP, ZOOM_MIN));
      sendTabsState();
    })
  );
  ipcMain.handle("browser:zoom-reset", () =>
    withActive((wc) => {
      wc.setZoomFactor(1);
      sendTabsState();
    })
  );
  ipcMain.handle("browser:open-external", () => withActive((wc) => shell.openExternal(wc.getURL())));
  ipcMain.handle("browser:copy-url", () => withActive((wc) => clipboard.writeText(wc.getURL())));
  ipcMain.handle("browser:history", () => readHistory());
  ipcMain.handle("browser:clear-history", () => {
    fs.rmSync(historyFile(), { force: true });
  });
  ipcMain.handle("browser:show-download", (_e, file) => shell.showItemInFolder(file));
  // Logging out of every 网申 site at once — for switching accounts, or
  // just not leaving a term's worth of sessions lying around.
  ipcMain.handle("browser:clear-site-data", async () => {
    await browserSession.clearStorageData();
    await browserSession.clearCache();
    for (const t of tabs) t.view.webContents.reload();
  });

  // ---- find in page ----
  ipcMain.handle("browser:find", async (_e, { text, forward = true, findNext = false }) => {
    const tab = activeTab();
    if (!tab) return { active: 0, total: 0 };
    const result = await tab.view.webContents
      .executeJavaScript(`(${findInPageText.toString()})(${JSON.stringify(text)}, ${!!forward}, ${!findNext})`)
      .catch(() => ({ active: 0, total: 0 }));
    send("browser:find-result", { tabId: tab.id, active: result.active, total: result.total });
    return result;
  });
  ipcMain.handle("browser:find-stop", () =>
    withActive((wc) => wc.executeJavaScript(`(${findInPageText.toString()})("", true, true)`).catch(() => {}))
  );

  ipcMain.handle("browser:set-bounds", (_e, rect) => {
    if (!rect) {
      lastBounds = null;
      detach();
      return;
    }
    lastBounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    const tab = activeTab() || createTab("about:blank");
    attach(tab);
  });

  ipcMain.handle("browser:capture-page", async () => {
    const tab = activeTab();
    if (!tab) return { url: "", title: "", text: "" };
    const wc = tab.view.webContents;
    const text = await wc.executeJavaScript(`(${capturePageText.toString()})()`);
    return { url: wc.getURL(), title: wc.getTitle(), text };
  });

  // Full-page-visible screenshot of the current tab as a PNG data URL —
  // the renderer posts it to the Next server to file as an attachment
  // (投递成功页 proof, 测评 instructions).
  ipcMain.handle("browser:screenshot", async () => {
    const tab = activeTab();
    if (!tab) throw new Error("没有打开的页面");
    const image = await tab.view.webContents.capturePage();
    return { dataUrl: image.toDataURL(), url: tab.view.webContents.getURL(), title: tab.view.webContents.getTitle() };
  });

  ipcMain.handle("browser:clear-marks", async () => {
    const tab = activeTab();
    if (!tab) return;
    for (const frame of allFrames(tab.view.webContents)) {
      await frame.executeJavaScript(`(${clearFillMarks.toString()})()`).catch(() => {});
    }
  });

  ipcMain.handle("browser:autofill", async (_e, resumeVersionId) => {
    const tab = activeTab();
    if (!tab) return;
    const wc = tab.view.webContents;
    lastAiFilled.set(tab.id, []);
    try {
      send("browser:autofill-status", { phase: "scanning", message: "正在读取页面…" });

      const profileRes = await fetch(`http://localhost:${port}/api/desktop-browser/profile`);
      if (!profileRes.ok) throw new Error("拿不到你的资料，先去账号设置填一下");
      const profile = await profileRes.json();

      const { fields, frameById } = await scanAllFrames(wc);
      if (fields.length === 0) throw new Error("这个页面上没找到可以填的表单——如果表单在弹窗里，先把它打开");

      const pairs = [];
      const candidates = []; // fields going to AI: {id, label, kind, options?}
      let neverGuessCount = 0;
      let alreadyFilled = 0;
      for (const field of fields) {
        if (field.hasValue) {
          alreadyFilled++;
          continue;
        }
        if (isNeverGuessField(field)) {
          neverGuessCount++;
          continue;
        }
        const value = matchBasicField(field, profile);
        if (value) {
          pairs.push({ id: field.id, value, source: "profile" });
          continue;
        }
        const label = field.label || field.placeholder || field.name;
        if (!label) continue; // nothing to even describe this field to the AI with
        if (field.tag === "textarea") {
          candidates.push({ id: field.id, label, kind: "essay" });
        } else if (field.tag === "select" || field.tag === "radio") {
          candidates.push({ id: field.id, label, kind: "choice", options: field.options || [] });
        } else {
          candidates.push({ id: field.id, label, kind: "short" });
        }
      }
      const basicCount = pairs.length;

      let essayCount = 0;
      let essayReused = 0;
      let shortFilledCount = 0;
      let aiError = null;
      if (candidates.length > 0 && !resumeVersionId) {
        aiError = "没选简历，这些字段跳过了";
      } else if (candidates.length > 0) {
        send("browser:autofill-status", {
          phase: "ai",
          message: `已填 ${basicCount} 个基础字段，正在用 AI 补全 ${candidates.length} 个字段…`,
        });
        try {
          const answerRes = await fetch(`http://localhost:${port}/api/desktop-browser/answer-questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ questions: candidates, resumeVersionId, profile }),
          });
          if (answerRes.ok) {
            const { answers } = await answerRes.json();
            const kindById = new Map(candidates.map((c) => [c.id, c.kind]));
            for (const a of answers || []) {
              const kind = kindById.get(a.id);
              const isSentinel = a.answer.trim().toUpperCase() === NEEDS_MANUAL_INPUT;
              if (kind !== "essay" && isSentinel) continue; // leave for manual entry
              pairs.push({ id: a.id, value: a.answer, source: "ai" });
              // Only fields actually written to the page, and only ones with
              // a cache row behind them (answerId), are correction-worthy —
              // matches basic profile fields aren't AI answers at all, so a
              // wrong one means "fix your saved profile", not "correct this".
              if (a.answerId) lastAiFilled.get(tab.id).push({ id: a.id, answerId: a.answerId, filledValue: a.answer });
              if (kind === "essay") {
                essayCount++;
                if (a.reused) essayReused++;
              } else {
                shortFilledCount++;
              }
            }
          } else {
            const body = await answerRes.json().catch(() => ({}));
            aiError = body.error || "AI 生成失败";
          }
        } catch {
          aiError = "AI 生成失败";
        }
      }

      await fillAllFrames(pairs, frameById);

      const parts = [`已填 ${basicCount} 个基础字段`];
      if (essayCount > 0) {
        const fresh = essayCount - essayReused;
        const bits = [];
        if (essayReused > 0) bits.push(`${essayReused} 道复用了之前保存的答案`);
        if (fresh > 0) bits.push(`${fresh} 道新生成`);
        parts.push(`${essayCount} 道问答题已填（${bits.join("，")}）`);
      }
      if (shortFilledCount > 0) {
        parts.push(`AI 从简历里补全了 ${shortFilledCount} 个其他字段`);
      }
      if (alreadyFilled > 0) parts.push(`${alreadyFilled} 个已有内容的字段没动`);
      if (neverGuessCount > 0) {
        parts.push(`${neverGuessCount} 个涉及证件号/密码/同意条款，没有自动填`);
      }
      const attempted = basicCount + essayCount + shortFilledCount + neverGuessCount + alreadyFilled;
      const stillManual = fields.length - attempted;
      if (stillManual > 0) {
        parts.push(
          aiError
            ? `${stillManual} 个字段没能自动填（${aiError}）`
            : `${stillManual} 个字段简历里没有对应信息，需要自己填`
        );
      }
      parts.push("填过的地方有紫色框，提交前逐个检查一遍");

      send("browser:autofill-status", { phase: "done", message: parts.join("；") });
    } catch (err) {
      send("browser:autofill-status", {
        phase: "error",
        message: err && err.message ? err.message : "自动填充失败",
      });
    }
  });

  // Lets a hand-edit after autofill correct the cached answer instead of
  // just correcting the page — otherwise the same wrong guess keeps coming
  // back on every future site that asks a similarly-worded question.
  // Compares each AI-answered field's *current* DOM value against what
  // fillFields originally wrote it as; only genuinely different, non-empty
  // values count as a correction worth saving.
  ipcMain.handle("browser:save-corrections", async () => {
    const tab = activeTab();
    const filledList = tab ? lastAiFilled.get(tab.id) || [] : [];
    if (!tab || !filledList.length) return { saved: 0 };
    const ids = filledList.map((f) => f.id);
    const current = {};
    for (const frame of allFrames(tab.view.webContents)) {
      const values = await frame.executeJavaScript(`(${readFieldValues.toString()})(${JSON.stringify(ids)})`).catch(() => ({}));
      Object.assign(current, values);
    }
    const corrections = filledList
      .filter((f) => {
        const value = current[f.id];
        return typeof value === "string" && value.trim() && value !== f.filledValue;
      })
      .map((f) => ({ answerId: f.answerId, answer: current[f.id] }));
    if (!corrections.length) return { saved: 0 };

    const res = await fetch(`http://localhost:${port}/api/desktop-browser/save-corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corrections }),
    });
    if (!res.ok) throw new Error("保存修改失败");
    const body = await res.json();

    // Reflects the just-saved values so re-clicking without further edits
    // reports "0 处修改" instead of re-submitting the same correction.
    for (const c of corrections) {
      const record = filledList.find((f) => f.answerId === c.answerId);
      if (record) record.filledValue = c.answer;
    }
    return { saved: body.saved ?? corrections.length };
  });
}

module.exports = { setupBrowserViewIpc };
