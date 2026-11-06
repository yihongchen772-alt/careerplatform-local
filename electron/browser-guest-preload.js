// Runs in every frame of a 网申浏览器 tab, in Electron's isolated world: the
// page's own scripts cannot see or replace anything here, and nothing is
// exposed to them. Two jobs about passwords, and two about the 网申 itself
// (bottom): which resume file went onto the page, and what the form said
// when it was sent.
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

// Which file the applicant put on the page — picked in the file dialog or
// dropped on an upload box — so 记为已投递 can tell which 简历版本 went out.
// Only the name and size leave the page; the file itself is never read.
function reportFiles(list) {
  const files = Array.from(list || []).slice(0, 5).map((file) => ({ name: String(file.name || "").slice(0, 200), size: Number(file.size) || 0 }));
  if (files.some((file) => file.name && file.size > 0)) ipcRenderer.send("browser-guest:files", files);
}
document.addEventListener("change", (event) => {
  const input = event.target;
  if (input && input.tagName === "INPUT" && input.type === "file") reportFiles(input.files);
}, true);
document.addEventListener("drop", (event) => {
  if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) reportFiles(event.dataTransfer.files);
}, true);

// What the form said when the applicant sent it (提交 / 投递 / 下一步), read in
// the capture phase before the page's own handler swaps the page out — so
// 记为已投递 still knows the job and the answers on the 投递成功 page after
// it. Works for hand-filled forms too. Login forms, passwords, ID, bank and
// address fields are never read.
const SEND_TEXT = /提\s*交|投\s*递|申\s*请|报\s*名|确\s*认|确\s*定|下一步|保\s*存|完\s*成|submit|apply|next|save|confirm|continue/i;
// Moves a form along rather than sending it.
const STEP_TEXT = /下一步|保\s*存|next|save|continue/i;
// Says it sends. 确定 / 完成 only count over an actual form (a cookie box has 确定 too).
const STRONG_SEND = /提\s*交|投\s*递|申\s*请|报\s*名|submit|apply/i;
const PRIVATE_LABEL = /密码|验证码|证件|身份证|银行卡|护照|家庭住址|password|captcha|passport|social security|bank account/i;
const LABEL_LIKE = 'label, legend, dt, th, [class*="label"], [class*="Label"], [class*="title"], [class*="Title"]';
const SELECT_LIKE = '[class*="select"], [class*="Select"], [class*="picker"], [class*="Picker"], [class*="cascader"]';
const SHOWN_VALUE = '[class*="selection-item"], [class*="selected-item"], [class*="selected-value"], [class*="selectItem"], [class*="select-value"], [class*="display-value"], [class*="selection__rendered"], [class*="tipEle"], [class*="value"]';

function shown(el) {
  return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

function textOf(el) {
  return String((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
}

const FIELD_LIKE = 'input:not([type="hidden"]), select, textarea, [contenteditable="true"]';

function labelOf(el) {
  const own = el.getAttribute("data-cp-fill-label") || el.getAttribute("aria-label");
  if (own) return own;
  if (el.id) {
    const forLabel = el.getRootNode().querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (textOf(forLabel)) return textOf(forLabel);
  }
  // <label>姓名 <input></label>; for a radio or checkbox that text is the option, not the question.
  if (el.type !== "radio" && el.type !== "checkbox") {
    const wrapping = el.closest("label");
    if (textOf(wrapping) && textOf(wrapping).length <= 40) return textOf(wrapping).replace(/[*＊:：]+$/g, "").replace(/^[*＊]\s*/, "");
  }
  // The nearest label-like text before the field, in the field's own row: walking
  // out, stop at the first text found, and never reach past another question's
  // field (a radio group's other options don't count as another question).
  const sameGroup = (other) => other === el || (el.type === "radio" && other.type === "radio" && other.name === el.name);
  let node = el.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const before = (other) => !!(other.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    const candidates = Array.from(node.querySelectorAll(LABEL_LIKE)).filter((candidate) => before(candidate) && !candidate.contains(el) && !candidate.querySelector(FIELD_LIKE));
    const fieldsBefore = Array.from(node.querySelectorAll(FIELD_LIKE)).filter((other) => before(other) && !sameGroup(other));
    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = candidates[i];
      const text = textOf(candidate).replace(/[*＊:：]+$/g, "").replace(/^[*＊]\s*/, "");
      if (!text || text.length > 40) continue;
      // Another field between this text and ours: the text is that field's label.
      if (fieldsBefore.some((other) => candidate.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      return text;
    }
    if (fieldsBefore.length) break;
  }
  return el.getAttribute("placeholder") || el.getAttribute("name") || "";
}

function valueOf(el) {
  if (el.tagName === "SELECT") return textOf(el.options[el.selectedIndex]);
  if (el.isContentEditable && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return textOf(el);
  const typed = String(el.value || "").trim();
  if (typed) return typed;
  // Component selects keep the choice in a display element, not the input.
  const box = el.closest(SELECT_LIKE);
  const display = box && box.querySelector(SHOWN_VALUE);
  return display ? textOf(display) : "";
}

function readSentForm(from) {
  const scope = (from && from.closest && from.closest("form")) || document;
  const fields = [];
  const seen = new Set();
  const add = (label, value) => {
    label = String(label || "").replace(/\s+/g, " ").trim().slice(0, 200);
    value = String(value || "").trim().slice(0, 5000);
    if (!label || !value || PRIVATE_LABEL.test(label) || /\d{17}[\dXx]/.test(value)) return;
    // A dropdown with no text of its own before it picks up its value, or the one
    // beside it, as a label: 「2025」 「8」 「+86」 are not questions.
    if (label === value || /^[\d\s+\-./:：年月日]+$/.test(label)) return;
    // Nor is the site's own job search.
    if (/(?:职位|岗位).{0,3}关键[字词]|关键[字词].{0,3}(?:职位|岗位)|搜索.{0,3}(?:职位|岗位)|(?:职位|岗位).{0,3}搜索/.test(label)) return;
    const key = label + "\u0000" + value;
    if (seen.has(key) || fields.length >= 250) return;
    seen.add(key);
    fields.push({ label, value });
  };
  const choices = new Map();
  for (const el of scope.querySelectorAll('input, select, textarea, [contenteditable="true"]')) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "password" && shown(el)) return null; // a login, not a 网申
    if (/^(?:hidden|file|submit|button|reset|image)$/.test(type)) continue;
    // A site's search box isn't an answer; the search box inside a dropdown (飞书) holds one's place.
    if (type === "search" && !el.closest(SELECT_LIKE)) continue;
    if (type === "radio" || type === "checkbox") {
      if (!el.checked) continue;
      const option = el.closest("label") || el.parentElement;
      if (!shown(option)) continue;
      // The question's label, read from the group's first option rather than the checked one.
      const first = (el.name && scope.querySelector('input[type="' + type + '"][name="' + CSS.escape(el.name) + '"]')) || el;
      const group = el.name || labelOf(first);
      const entry = choices.get(group) || { label: labelOf(first), values: [] };
      entry.values.push(textOf(option) || el.value);
      choices.set(group, entry);
      continue;
    }
    if (!shown(el) && !shown(el.closest(SELECT_LIKE))) continue;
    add(labelOf(el), valueOf(el));
  }
  for (const entry of choices.values()) add(entry.label, entry.values.join("、"));
  return fields;
}

// Tells the main process what the form said; true when this was a real send
// rather than 下一步 / 保存 (保存并提交 does send).
function reportSentForm(from, label) {
  let fields = null;
  try {
    fields = readSentForm(from);
  } catch {
    // A page that can't be read is just not remembered.
  }
  if (!fields) return false;
  const step = STEP_TEXT.test(label) && !/提\s*交|投\s*递/.test(label);
  const final = !step && (STRONG_SEND.test(label) || fields.length >= 3);
  ipcRenderer.send("browser-guest:form-sent", { fields, final });
  return final;
}

// 投递成功 is often only a brief toast over the form. The App's periodic check
// can miss it, and rightly refuses a page still showing a form, so right after
// a real send the new text itself is watched for half a minute. Long additions
// (a whole new page) are left to that periodic check.
const SUCCESS_TEXT = /投递成功|成功投递|申请成功|成功申请|报名成功|提交成功|成功提交|简历已投递|申请已提交|投递已完成|投递完成|application submitted|successfully applied|thank you for applying/i;
// A bare 提交成功 could be anything (a test, a survey): the page must be about a job, as in detectApplicationSuccess.
const VAGUE_SUCCESS = /^(?:提交成功|成功提交)$/;
const ABOUT_A_JOB = /岗位|职位|招聘|简历|投递|求职|job|career|application/i;
let successWatch = null;
function stopSuccessWatch() {
  if (!successWatch) return;
  clearTimeout(successWatch.timer);
  successWatch.observer.disconnect();
  successWatch = null;
}
function watchForSuccess(label) {
  if (typeof MutationObserver !== "function" || !document.documentElement) return;
  // A bare 提交成功 after 确定 could be a section being saved; after 提交 / 投递 it's the 网申.
  const vagueCounts = STRONG_SEND.test(label);
  stopSuccessWatch();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const nodes = record.type === "characterData" ? [record.target] : Array.from(record.addedNodes);
      for (const node of nodes) {
        const text = String((node.nodeType === 1 ? node.innerText || node.textContent : node.textContent) || "");
        const match = text.length <= 300 ? SUCCESS_TEXT.exec(text) : null;
        if (!match) continue;
        if (VAGUE_SUCCESS.test(match[0]) && (!vagueCounts || !ABOUT_A_JOB.test(document.title + " " + String((document.body && document.body.innerText) || "").slice(0, 3000)))) continue;
        stopSuccessWatch();
        ipcRenderer.send("browser-guest:success-seen", { evidence: match[0] });
        return;
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  successWatch = { observer, timer: setTimeout(stopSuccessWatch, 30000) };
}

function buttonText(el) {
  return String((el && (el.innerText || el.value || el.getAttribute("aria-label"))) || "").replace(/\s+/g, "");
}

document.addEventListener("submit", (event) => {
  const label = buttonText(event.submitter);
  if (reportSentForm(event.target, label)) watchForSuccess(label || "提交");
}, true);
document.addEventListener("click", (event) => {
  const target = event.target && event.target.closest ? event.target.closest('button, [role="button"], input[type="submit"], input[type="button"], a, [class*="btn"], [class*="button"]') : null;
  if (!target) return;
  const text = buttonText(target);
  if (text && text.length <= 12 && SEND_TEXT.test(text) && reportSentForm(target, text)) watchForSuccess(text);
}, true);
