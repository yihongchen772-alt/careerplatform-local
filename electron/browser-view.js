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

  function labelFor(el) {
    if (el.id) {
      const byFor = document.querySelector('label[for="' + el.id + '"]');
      if (byFor && byFor.textContent) return byFor.textContent.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping && wrapping.textContent) return wrapping.textContent.trim();
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
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
    results.push({
      id,
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      label: labelFor(el),
      placeholder: el.getAttribute("placeholder") || "",
      name: el.getAttribute("name") || "",
    });
  });

  return results;
}

function fillFields(pairs) {
  let filled = 0;
  pairs.forEach((p) => {
    const el = document.querySelector('[data-cp-fill-id="' + p.id + '"]');
    if (!el || !p.value) return;
    if (el.tagName.toLowerCase() === "select") {
      const match = Array.from(el.options).find((o) => o.textContent.trim() === p.value);
      if (!match) return;
      el.value = match.value;
    } else {
      el.value = p.value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    filled++;
  });
  return filled;
}

// Runs in the main process, not injected — matches detected form fields to
// the user's own profile by keyword. Intentionally conservative: a field
// with no confident match is left alone rather than guessed at.
const BASIC_FIELD_RULES = [
  { keys: ["姓名", "真实姓名", "name"], get: (p) => p.name },
  { keys: ["手机", "电话", "联系电话", "phone", "mobile", "tel"], get: (p) => p.phone },
  { keys: ["邮箱", "email", "mail"], get: (p) => p.email },
  { keys: ["学校", "毕业院校", "院校", "school", "university"], get: (p) => p.school },
  {
    keys: ["毕业年份", "毕业时间", "graduate"],
    get: (p) => (p.graduationYear ? String(p.graduationYear) : ""),
  },
  { keys: ["意向城市", "期望城市", "工作城市", "city"], get: (p) => p.preferredCities },
];

function matchBasicField(field, profile) {
  const haystack = `${field.label} ${field.placeholder} ${field.name}`.toLowerCase();
  for (const rule of BASIC_FIELD_RULES) {
    if (rule.keys.some((k) => haystack.includes(k.toLowerCase()))) {
      const value = rule.get(profile);
      if (value) return value;
    }
  }
  return null;
}

function normalizeUrl(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return "about:blank";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

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

  ipcMain.handle("browser:autofill", async () => {
    try {
      send("browser:autofill-status", { phase: "scanning", message: "正在读取页面…" });

      const profileRes = await fetch(`http://localhost:${port}/api/desktop-browser/profile`);
      if (!profileRes.ok) throw new Error("拿不到你的资料，先去账号设置填一下");
      const profile = await profileRes.json();

      const fields = await view.webContents.executeJavaScript(`(${scanPageFields.toString()})()`);

      const pairs = [];
      const openQuestions = [];
      for (const field of fields) {
        const value = matchBasicField(field, profile);
        if (value) {
          pairs.push({ id: field.id, value });
        } else if (field.tag === "textarea") {
          openQuestions.push({ id: field.id, label: field.label || field.placeholder || field.name });
        }
      }
      const basicCount = pairs.length;

      let answeredCount = 0;
      let aiError = null;
      if (openQuestions.length > 0) {
        send("browser:autofill-status", {
          phase: "ai",
          message: `正在用 AI 生成 ${openQuestions.length} 道问答题的参考答案…`,
        });
        try {
          const answerRes = await fetch(`http://localhost:${port}/api/desktop-browser/answer-questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ questions: openQuestions }),
          });
          if (answerRes.ok) {
            const { answers } = await answerRes.json();
            for (const a of answers || []) {
              pairs.push({ id: a.id, value: a.answer });
              answeredCount++;
            }
          } else {
            const body = await answerRes.json().catch(() => ({}));
            aiError = body.error || "AI 生成问答失败";
          }
        } catch {
          aiError = "AI 生成问答失败";
        }
      }

      await view.webContents.executeJavaScript(`(${fillFields.toString()})(${JSON.stringify(pairs)})`);

      const parts = [`已填 ${basicCount} 个基础字段`];
      if (answeredCount > 0) {
        parts.push(`AI 生成并填了 ${answeredCount} 道问答题——提交前务必自己检查一遍，尤其是 AI 写的那几段`);
      }
      const missed = openQuestions.length - answeredCount;
      if (missed > 0) {
        parts.push(aiError ? `${missed} 道问答题 AI 没能生成（${aiError}），需要自己写` : `${missed} 道问答题需要自己写`);
      }
      const unmatched = fields.length - basicCount - answeredCount;
      if (unmatched > 0) parts.push(`${unmatched} 个字段没认出来，需要自己填`);

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
