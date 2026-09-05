const { ipcMain, WebContentsView, session } = require("electron");

// Pure, self-contained functions — these get stringified and injected into
// the visited page via executeJavaScript, so they can't close over anything
// from this module. Keep them free of outside references.

function scanPageFields() {
  const results = [];
  let counter = 0;
  const elements = document.querySelectorAll(
    'input[type="text"], input[type="tel"], input[type="email"], input[type="number"], input:not([type]), textarea, select'
  );

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
      if (/form-item|form-group|field|form-row|input-group|form-cell/.test(cls)) {
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

  elements.forEach((el) => {
    if (el.type === "password" || el.disabled || el.readOnly) return;
    const id = "cp-fill-" + counter++;
    el.setAttribute("data-cp-fill-id", id);
    const entry = {
      id,
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      label: labelFor(el),
      placeholder: el.getAttribute("placeholder") || "",
      name: el.getAttribute("name") || "",
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
  const nativeInputSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  ).set;

  pairs.forEach((p) => {
    const el = document.querySelector('[data-cp-fill-id="' + p.id + '"]');
    if (!el || !p.value) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const match = Array.from(el.options).find((o) => o.textContent.trim() === p.value);
      if (!match) return;
      el.value = match.value;
    } else if (tag === "textarea") {
      nativeTextareaSetter.call(el, p.value);
    } else {
      nativeInputSetter.call(el, p.value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    filled++;
  });
  return filled;
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
];

function fieldHaystack(field) {
  return `${field.label} ${field.placeholder} ${field.name}`.toLowerCase();
}

function matchBasicField(field, profile) {
  const haystack = fieldHaystack(field);
  for (const rule of BASIC_FIELD_RULES) {
    if (rule.keys.some((k) => haystack.includes(k.toLowerCase()))) {
      const value = rule.get(profile);
      if (value) return value;
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
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

// Module-level, not per-call: on mac, closing the window without background
// reminders on leaves the app running with zero windows, and `activate` then
// calls createWindow() again — a second real BrowserWindow, not a no-op.
// ipcMain.handle() throws if the same channel is registered twice, so the
// handlers below are wired up exactly once; only `currentWindow` (and the
// view's attachment to it) gets rebound on each call.
let registered = false;
let currentWindow = null;
let view = null;
let attached = false;

function send(channel, payload) {
  if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send(channel, payload);
}

/**
 * Sets up the embedded 网申浏览器 panel: a WebContentsView layered on top of
 * the main window's own content, positioned by whatever bounds the renderer
 * reports for its placeholder div. Isolated from the main window's own
 * session (own partition) so it behaves like a real browser — logins on
 * job-application sites persist across restarts — but never shares any
 * bridge/preload with the arbitrary third-party pages it loads.
 */
function setupBrowserViewIpc(mainWindow, port) {
  currentWindow = mainWindow;
  // A fresh window never has the view attached yet, even if a previous
  // window did — that attachment died with the old window.
  attached = false;
  if (registered) return;
  registered = true;

  view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: session.fromPartition("persist:job-application-browser"),
    },
  });
  view.setBackgroundColor("#ffffff");

  function sendNavState() {
    send("browser:nav-state", {
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      canGoBack: view.webContents.navigationHistory.canGoBack(),
      canGoForward: view.webContents.navigationHistory.canGoForward(),
      loading: view.webContents.isLoading(),
      zoomFactor: view.webContents.getZoomFactor(),
    });
  }

  view.webContents.on("did-navigate", sendNavState);
  view.webContents.on("did-navigate-in-page", sendNavState);
  view.webContents.on("page-title-updated", sendNavState);
  view.webContents.on("did-start-loading", sendNavState);
  view.webContents.on("did-stop-loading", sendNavState);
  // 网申表单常见的第三方登录/验证弹窗（微信扫码等）会被挡住——已知的 v1 限制，
  // 先不处理，真遇到再补 setWindowOpenHandler 的 allow 分支。
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  ipcMain.handle("browser:navigate", (_e, url) => {
    view.webContents.loadURL(normalizeUrl(url));
  });
  ipcMain.handle("browser:back", () => {
    if (view.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack();
  });
  ipcMain.handle("browser:forward", () => {
    if (view.webContents.navigationHistory.canGoForward())
      view.webContents.navigationHistory.goForward();
  });
  ipcMain.handle("browser:reload", () => view.webContents.reload());

  ipcMain.handle("browser:zoom-in", () => {
    view.webContents.setZoomFactor(Math.min(view.webContents.getZoomFactor() + ZOOM_STEP, ZOOM_MAX));
    sendNavState();
  });
  ipcMain.handle("browser:zoom-out", () => {
    view.webContents.setZoomFactor(Math.max(view.webContents.getZoomFactor() - ZOOM_STEP, ZOOM_MIN));
    sendNavState();
  });
  ipcMain.handle("browser:zoom-reset", () => {
    view.webContents.setZoomFactor(1);
    sendNavState();
  });

  ipcMain.handle("browser:set-bounds", (_e, rect) => {
    if (!rect) {
      if (attached) {
        currentWindow.contentView.removeChildView(view);
        attached = false;
      }
      return;
    }
    if (!attached) {
      currentWindow.contentView.addChildView(view);
      attached = true;
    }
    view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  });

  ipcMain.handle("browser:autofill", async (_e, resumeVersionId) => {
    try {
      send("browser:autofill-status", { phase: "scanning", message: "正在读取页面…" });

      const profileRes = await fetch(`http://localhost:${port}/api/desktop-browser/profile`);
      if (!profileRes.ok) throw new Error("拿不到你的资料，先去账号设置填一下");
      const profile = await profileRes.json();

      const fields = await view.webContents.executeJavaScript(`(${scanPageFields.toString()})()`);

      const pairs = [];
      const candidates = []; // fields going to AI: {id, label, kind, options?}
      let neverGuessCount = 0;
      for (const field of fields) {
        if (isNeverGuessField(field)) {
          neverGuessCount++;
          continue;
        }
        const value = matchBasicField(field, profile);
        if (value) {
          pairs.push({ id: field.id, value });
          continue;
        }
        const label = field.label || field.placeholder || field.name;
        if (!label) continue; // nothing to even describe this field to the AI with
        if (field.tag === "textarea") {
          candidates.push({ id: field.id, label, kind: "essay" });
        } else if (field.tag === "select") {
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
          message: `正在用 AI 补全 ${candidates.length} 个字段…`,
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
              pairs.push({ id: a.id, value: a.answer });
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

      await view.webContents.executeJavaScript(`(${fillFields.toString()})(${JSON.stringify(pairs)})`);

      const parts = [`已填 ${basicCount} 个基础字段`];
      if (essayCount > 0) {
        const fresh = essayCount - essayReused;
        const bits = [];
        if (essayReused > 0) bits.push(`${essayReused} 道复用了之前保存的答案`);
        if (fresh > 0) bits.push(`${fresh} 道新生成`);
        parts.push(`${essayCount} 道问答题已填（${bits.join("，")}）——提交前务必自己检查一遍`);
      }
      if (shortFilledCount > 0) {
        parts.push(`AI 从简历里补全了 ${shortFilledCount} 个其他字段——也检查一下`);
      }
      if (neverGuessCount > 0) {
        parts.push(`${neverGuessCount} 个涉及证件号码/密码等敏感信息，没有自动填`);
      }
      const attempted = basicCount + essayCount + shortFilledCount + neverGuessCount;
      const stillManual = fields.length - attempted;
      if (stillManual > 0) {
        parts.push(
          aiError
            ? `${stillManual} 个字段没能自动填（${aiError}），需要自己填`
            : `${stillManual} 个字段简历里没有对应信息，需要自己填`
        );
      }

      send("browser:autofill-status", { phase: "done", message: parts.join("；") });
    } catch (err) {
      send("browser:autofill-status", {
        phase: "error",
        message: err && err.message ? err.message : "自动填充失败",
      });
    }
  });
}

module.exports = { setupBrowserViewIpc };
