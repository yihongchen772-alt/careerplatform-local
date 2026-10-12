// Runs in every frame of a 网申浏览器 tab, in Electron's isolated world: the
// page's own scripts cannot see or replace anything here, and nothing is
// exposed to them. Two jobs, both about passwords:
//  - when a login / sign-up form is submitted, tell the main process the
//    account and password typed, so the browser can offer to keep them;
//  - when a password box appears (pages often draw the login form late, or
//    in a pop-up), tell the main process, so a kept password can be filled.
const { ipcRenderer } = require("electron");

const NOT_USERNAME = /验证码|校验码|动态码|短信|图形|captcha|verif|otp|\bcode\b/i;
const USERNAME_HINT = /user|account|login|email|mail|phone|mobile|tel|账号|帐号|用户名|手机|邮箱|登录名/i;
const SUBMIT_TEXT = /登\s*录|登\s*入|log\s*in|sign\s*in|注\s*册|sign\s*up|register|提\s*交|确\s*定|下一步|完成/i;

function visible(el) {
  if (!el || !el.isConnected) return false;
  const style = getComputedStyle(el);
  return el.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function passwordInputs(root) {
  return Array.from(root.querySelectorAll('input[type="password"]')).filter(visible);
}

function describe(el) {
  return [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.getAttribute("autocomplete")].filter(Boolean).join(" ");
}

// The form, or the nearest block around the password box that holds the
// other fields of the same login (SPA logins rarely use <form>).
function scopeOf(el) {
  const form = el.closest("form");
  if (form) return form;
  let node = el.parentElement;
  for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
    if (passwordInputs(node).length && node.querySelectorAll("input").length >= 2) return node;
  }
  return document.body || document.documentElement;
}

function usernameFor(password, scope) {
  const inputs = Array.from(scope.querySelectorAll("input")).filter((input) =>
    visible(input) && /^(?:text|email|tel|number|)$/i.test(input.getAttribute("type") || "text") && input.value.trim() && !NOT_USERNAME.test(describe(input)));
  const named = inputs.find((input) => USERNAME_HINT.test(describe(input)) || input.getAttribute("autocomplete") === "username");
  const before = inputs.filter((input) => input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING);
  return ((named || before[before.length - 1] || inputs[0] || {}).value || "").trim();
}

let lastReported = "";
function report(from) {
  const scope = from ? scopeOf(from) : document;
  const filled = passwordInputs(scope).filter((input) => input.value);
  if (!filled.length) return;
  let password = filled[0].value;
  let kind = "login";
  if (filled.length >= 2) {
    const [a, b] = filled.slice(-2).map((input) => input.value);
    // 新密码 + 确认密码: keep the new one. Two that differ is a typo, not a save.
    if (a !== b) return;
    password = b;
    kind = filled.length >= 3 ? "change" : "signup";
  }
  const username = usernameFor(filled[0], scope).slice(0, 200);
  const key = `${username}\u0000${password}`;
  if (key === lastReported) return;
  lastReported = key;
  ipcRenderer.send("browser-guest:login", { username, password: password.slice(0, 500), kind });
}

document.addEventListener("submit", (event) => report(event.target), true);
document.addEventListener("click", (event) => {
  const target = event.target && event.target.closest ? event.target.closest('button, [role="button"], input[type="submit"], input[type="button"], a, .btn, [class*="button"]') : null;
  if (!target) return;
  const text = (target.innerText || target.value || target.getAttribute("aria-label") || "").replace(/\s+/g, "");
  if (text.length > 12 || !SUBMIT_TEXT.test(text)) return;
  // Read in the capture phase, before the page's own handler runs: some
  // sites encrypt the typed password into a hidden field and clear the box.
  report(target);
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target && event.target.type === "password") report(event.target);
}, true);

// A password box showing up: worth checking for a kept password.
let announced = false;
let timer = null;
function checkForPasswordBox() {
  timer = null;
  const present = passwordInputs(document).length > 0;
  if (present && !announced) ipcRenderer.send("browser-guest:login-form");
  announced = present;
}
function schedule() {
  if (!timer) timer = setTimeout(checkForPasswordBox, 400);
}
const watch = () => {
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["type", "style", "class", "hidden"] });
  schedule();
};
if (document.documentElement) watch();
else document.addEventListener("DOMContentLoaded", watch, { once: true });
