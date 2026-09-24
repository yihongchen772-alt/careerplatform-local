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
  // Wizard pages keep earlier steps in the DOM, hidden. Their ids from the
  // last scan would collide with this scan's and querySelector would hand
  // the value to the hidden old field — clear them first.
  document.querySelectorAll("[data-cp-fill-id]").forEach((el) => el.removeAttribute("data-cp-fill-id"));
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
    return { radios, options, label, hasValue: radios.some((r) => r.checked) };
  }

  // Component-library dropdowns: a div that only becomes a list when
  // clicked (Ant Design .ant-select, Element .el-select, and anything using
  // the ARIA combobox pattern). No options are read here — the fill step
  // opens each one and picks the closest match to the value it's given.
  const customSelectors = ".ant-select, .el-select, [role='combobox']:not(input):not(select), input[role='combobox'][readonly], input[aria-haspopup='listbox']";
  document.querySelectorAll(customSelectors).forEach((el) => {
    const container = el.closest(".ant-select, .el-select") || el;
    if (container.getAttribute("data-cp-fill-id")) return;
    if (!isVisible(container)) return;
    if (container.classList.contains("ant-select-disabled") || container.classList.contains("is-disabled") || container.getAttribute("aria-disabled") === "true") return;
    const multiple = container.classList.contains("ant-select-multiple") || container.getAttribute("aria-multiselectable") === "true";
    if (multiple) return; // never guess multi-selects
    const shown = container.querySelector(".ant-select-selection-item, .el-select__selected-item, .el-select__tags");
    const innerInput = container.querySelector("input");
    const hasValue = !!(shown && shown.textContent.trim()) || !!(innerInput && innerInput.readOnly && innerInput.value && innerInput.value.trim());
    const id = prefix + "s" + counter++;
    container.setAttribute("data-cp-fill-id", id);
    results.push({
      id,
      tag: "custom-select",
      type: "",
      label: labelFor(innerInput || container) || labelFor(container),
      placeholder: (innerInput && innerInput.getAttribute("placeholder")) || (container.querySelector(".ant-select-selection-placeholder, .el-select__placeholder") || {}).textContent || "",
      name: (innerInput && innerInput.getAttribute("name")) || container.id || "",
      hasValue,
    });
  });

  elements.forEach((el) => {
    if (el.type === "password" || el.disabled || el.readOnly || !isVisible(el)) return;
    // Inner inputs of custom selects were handled above.
    if (el.closest("[data-cp-fill-id^='" + prefix + "s']")) return;
    if (el.type === "radio") {
      const group = radioGroup(el);
      if (!group) return;
      const id = prefix + "r" + counter++;
      group.radios.forEach((r, i) => r.setAttribute("data-cp-fill-id", id + ":" + i));
      results.push({ id, tag: "radio", type: "radio", label: group.label, placeholder: "", name: el.getAttribute("name") || "", options: group.options, hasValue: group.hasValue });
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

// Conservative success-page detection. This only proposes creating a local
// application record; the user still confirms it in our own UI. Requiring a
// strong phrase and a mostly-finished page avoids firing on buttons such as
// “提交申请” before they are clicked.
function detectApplicationSuccess() {
  const text = ((document.body && document.body.innerText) || "").replace(/\s+/g, " ").trim();
  const phrases = [
    "投递成功", "申请成功", "提交成功", "简历已投递", "申请已提交",
    "投递已完成", "感谢您的申请", "thank you for applying", "application submitted",
    "application has been submitted", "successfully applied",
  ];
  const lower = text.toLowerCase();
  const evidence = phrases.find((p) => lower.includes(p.toLowerCase()));
  if (!evidence) return null;
  if ((evidence === "提交成功" || evidence === "申请成功") && !/岗位|职位|招聘|简历|投递|求职|job|career|application/i.test(text)) {
    return null;
  }
  const visibleEditable = Array.from(document.querySelectorAll("input, textarea, select")).filter((el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return !el.disabled && r.width > 0 && r.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }).length;
  if (visibleEditable > 2) return null;
  return { evidence, url: location.href, title: document.title || "" };
}

function markResumeFileInputs() {
  const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((el) => !el.disabled);
  let marked = 0;
  for (const el of inputs) {
    const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const nearby = el.closest("label, .form-item, .ant-form-item, .el-form-item, [class*='upload']");
    const description = [
      el.name, el.id, el.getAttribute("aria-label"), el.getAttribute("title"),
      label && label.textContent, nearby && nearby.textContent,
    ].filter(Boolean).join(" ");
    const accept = (el.getAttribute("accept") || "").toLowerCase();
    const looksLikeResume = /简历|履历|resume|curriculum|\bcv\b/i.test(description);
    const soleDocumentUpload = inputs.length === 1 && (!accept || /pdf|doc|document|word/.test(accept));
    if (!looksLikeResume && !soleDocumentUpload) continue;
    el.setAttribute("data-cp-resume-upload", "1");
    marked++;
  }
  return marked;
}

// AI's honest "couldn't find this in the resume" answer for a short/choice
// field — distinct from a real value so it never gets written into the page
// (a sentence dropped into a 性别 dropdown would be worse than leaving it
// blank). Deliberately an unambiguous English sentinel, not matched against
// any wording the AI might naturally produce.
const NEEDS_MANUAL_INPUT = "NEEDS_MANUAL_INPUT";

async function fillFields(pairs) {
  const filled = [];
  const failed = [];
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
  function mark(el, source, answerId) {
    el.setAttribute("data-cp-filled", source);
    if (answerId) el.setAttribute("data-cp-answer-id", answerId);
    if (source === "profile") el.setAttribute("data-cp-profile-filled", "1");
    el.style.setProperty("outline", (source === "ai" ? "2px solid #d946ef" : source === "remembered" ? "2px solid #16a34a" : "2px solid #8b5cf6"), "important");
    el.style.setProperty("outline-offset", "1px", "important");
  }

  for (const p of pairs) {
    if (!p.value) continue;
    if (/-r\d+$/.test(p.id)) {
      // radio group (ids are "<frame>-r<n>", fields are "<frame>-f<n>"):
      // click the option whose label matches
      const radios = Array.from(document.querySelectorAll('[data-cp-fill-id^="' + p.id + ':"]'));
      const target = radios.find((r) => {
        const wrapping = r.closest("label");
        const text = ((wrapping ? wrapping.textContent : r.nextSibling && r.nextSibling.textContent) || r.value || "").trim();
        return text === p.value;
      });
      if (!target) { failed.push(p.label || p.id); continue; }
      target.click();
      if (!target.checked) { failed.push(p.label || p.id); continue; }
      mark(target.closest("label") || target, p.source || "profile", p.answerId);
      filled.push(p.id);
      continue;
    }
    const el = document.querySelector('[data-cp-fill-id="' + p.id + '"]');
    if (!el || (p.tag && el.tagName.toLowerCase() !== p.tag) || (el.value && String(el.value).trim())) {
      failed.push(p.label || p.id);
      continue;
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const match = Array.from(el.options).find((o) => o.textContent.trim() === p.value);
      if (!match) { failed.push(p.label || p.id); continue; }
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
    // Controlled components can revert after input/change handlers run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const actual = tag === "select" ? (el.options[el.selectedIndex]?.textContent || "").trim() : el.value;
    const expected = el.type === "date" || el.type === "month" ? normalizeDate(p.value, el.type) : p.value;
    if (actual !== expected) { failed.push(p.label || p.id); continue; }
    mark(el, p.source || "profile", p.answerId);
    filled.push(p.id);
  }
  return { filled, failed };
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

// Opens each custom dropdown, reads whatever options it renders, clicks the
// best match for the wanted value, and closes it again if nothing fits.
// Async because these libraries render the option list on the next tick.
async function fillCustomSelects(pairs) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const filled = [];
  const failed = [];
  function visibleOptions() {
    const nodes = document.querySelectorAll(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:not(.ant-select-item-option-disabled), " +
        ".el-select-dropdown:not([style*='display: none']) .el-select-dropdown__item:not(.is-disabled), " +
        "[role='listbox'] [role='option']:not([aria-disabled='true'])"
    );
    return Array.from(nodes).filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  function optionText(n) {
    const inner = n.querySelector(".ant-select-item-option-content");
    return ((inner || n).textContent || "").trim();
  }
  function pick(options, value) {
    const v = String(value).trim();
    return (
      options.find((o) => optionText(o) === v) ||
      options.find((o) => optionText(o).includes(v)) ||
      options.find((o) => v.includes(optionText(o)) && optionText(o).length >= 2) ||
      null
    );
  }
  function mark(el, source) {
    el.setAttribute("data-cp-filled", source);
    el.style.setProperty("outline", (source === "ai" ? "2px solid #d946ef" : source === "remembered" ? "2px solid #16a34a" : "2px solid #8b5cf6"), "important");
    el.style.setProperty("outline-offset", "1px", "important");
  }
  for (const p of pairs) {
    const container = document.querySelector('[data-cp-fill-id="' + p.id + '"]');
    if (!container || !p.value) continue;
    // Innermost first: a click on the inner input bubbles up through the
    // wrapper/selector, so every library's own handler sees it.
    const trigger = container.querySelector("input:not([type='hidden'])") || container.querySelector(".ant-select-selector, .el-select__wrapper") || container;
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger.click();
    await sleep(350);
    let options = visibleOptions();
    let target = pick(options, p.value);
    // Searchable selects (and virtual lists that only render a screenful):
    // type the value to narrow the list, then look again.
    const searchInput = container.querySelector("input:not([readonly]):not([type='hidden'])");
    if (!target && searchInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(searchInput, String(p.value));
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(450);
      options = visibleOptions();
      target = pick(options, p.value);
      if (!target) {
        setter.call(searchInput, "");
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    if (target) {
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      target.click();
      await sleep(150);
      const shown = container.querySelector(".ant-select-selection-item, .el-select__selected-item, .el-select__tags");
      const visibleValue = (shown?.textContent || container.querySelector("input[readonly]")?.value || "").trim();
      if (visibleValue && (visibleValue === String(p.value).trim() || visibleValue.includes(String(p.value).trim()))) {
        mark(container, p.source || "profile");
        filled.push(p.id);
      } else {
        failed.push(p.label || p.id);
      }
    } else {
      failed.push(p.label || p.id);
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.body.click();
      await sleep(100);
    }
  }
  return { filled, failed };
}

// Side-effect-free count of what an autofill could touch right now — used
// by the multi-step form watcher to notice "a new form page just appeared".
function countFillableFields() {
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }
  let count = 0;
  const seenRadio = new Set();
  const labels = [];
  document
    .querySelectorAll('input[type="text"], input[type="tel"], input[type="email"], input[type="number"], input[type="date"], input[type="month"], input[type="radio"], input:not([type]), textarea, select, .ant-select, .el-select')
    .forEach((el) => {
      if (el.disabled || !isVisible(el)) return;
      if (el.type === "radio") {
        const name = el.getAttribute("name") || "";
        if (seenRadio.has(name)) return;
        seenRadio.add(name);
        const group = el.form ? el.form.querySelectorAll('input[type="radio"][name="' + name + '"]') : [el];
        if (Array.from(group).some((r) => r.checked)) return;
      } else if (el.classList && (el.classList.contains("ant-select") || el.classList.contains("el-select"))) {
        if (el.querySelector(".ant-select-selection-item, .el-select__selected-item")) return;
      } else if (el.readOnly || (el.value && String(el.value).trim())) {
        return;
      }
      count++;
      if (labels.length < 6) labels.push((el.getAttribute("name") || el.getAttribute("placeholder") || el.id || "").slice(0, 20));
    });
  return { count, signature: location.href.split("#")[0] + "|" + count + "|" + labels.join(",") };
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
      result[id] = { value: selected ? selected.textContent.trim() : "", answerId: el.getAttribute("data-cp-answer-id"), profileFilled: el.getAttribute("data-cp-profile-filled") === "1" };
    } else {
      result[id] = { value: el.value, answerId: el.getAttribute("data-cp-answer-id"), profileFilled: el.getAttribute("data-cp-profile-filled") === "1" };
    }
  });
  return result;
}

function memoryCandidate(snapshot, filledList) {
  if (snapshot.profileFilled) return null;
  const value = String(snapshot.value || "").trim();
  if (!value) return null;
  const draft = filledList.findLast((entry) => entry.answerId === snapshot.answerId);
  if (draft && draft.filledValue === value) return null;
  return { value, answerId: draft?.answerId };
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
    get: (p) => p.educationEnd || (p.graduationYear ? String(p.graduationYear) : ""),
  },
  { keys: ["入学时间", "入学年份", "入学年月"], get: (p) => p.educationStart },
  { keys: ["专业", "major"], get: (p) => p.major },
  { keys: ["学历", "最高学历", "degree", "education level"], get: (p) => p.degree },
  // Before GPA: "英语成绩" must land here, not in the GPA rule below.
  { keys: ["英语", "外语", "cet", "english", "语言能力"], get: (p) => p.english },
  { keys: ["gpa", "绩点", "平均分", "平均成绩", "学习成绩", "加权"], get: (p) => p.gpa },
  { keys: ["政治面貌", "politic"], get: (p) => p.politics },
  { keys: ["籍贯", "户籍", "户口所在地", "hometown"], get: (p) => p.hometown },
  { keys: ["民族", "ethnic"], get: (p) => p.ethnicity },
  { keys: ["现居", "现住", "所在城市", "常住"], get: (p) => p.currentCity },
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

function isSplitNameField(field) {
  return /(?:^|\W)(?:first|last|given|family|middle|surname)(?:\s|[-_])*name(?:$|\W)|(?:^|\W)surname(?:$|\W)|姓氏|名字|名[（(]拼音|姓[（(]拼音|名的拼音|姓的拼音|(?:^|\s)[姓名](?:\s|$)/i.test(fieldHaystack(field));
}

function isOpenEndedQuestionField(field) {
  if (field.tag === "textarea") return true;
  if (field.tag !== "input" || !["text", "", undefined].includes(field.type)) return false;
  const label = fieldHaystack(field);
  return /[?？]|为什么|为何|请描述|请介绍|请说明|谈谈|自我评价|个人优势|求职动机|职业规划|相关经历|why|describe|tell us|motivation|strength|experience|career plan|interested in/i.test(label);
}

function projectFieldKind(haystack) {
  if (/项目(?:名称|名)(?!称)|project[\s_-]*(?:name|title)/i.test(haystack)) return "name";
  if (/项目(?:角色|职位)|project[\s_-]*role/i.test(haystack)) return "role";
  if (/项目(?:开始|起始)|project[\s_-]*start/i.test(haystack)) return "start";
  if (/项目(?:结束|截止)|project[\s_-]*end/i.test(haystack)) return "end";
  if (/项目(?:职责|负责|贡献|成果)|project[\s_-]*(?:responsibilit|contribution|achievement)/i.test(haystack)) return "responsibilities";
  if (/项目(?:描述|简介|介绍|内容)|project[\s_-]*(?:description|summary|overview)/i.test(haystack)) return "description";
  if (/项目经历|project[\s_-]*experience/i.test(haystack)) return "summary";
  return null;
}

function matchFieldOption(field, value) {
  if (!value) return null;
  if (!field.options) return value;
  return field.options.find((option) => option === value) ||
    field.options.find((option) => option.includes(value) || value.includes(option)) || null;
}

function matchBasicField(field, profile, projectIndexes) {
  const haystack = fieldHaystack(field);
  // A saved full name cannot safely be split into first/last/given/family
  // names (especially for bilingual forms). Leave these for the applicant.
  if (isSplitNameField(field)) return null;
  const projectKind = projectFieldKind(haystack);
  if (projectKind) {
    const index = projectIndexes?.get(projectKind) || 0;
    projectIndexes?.set(projectKind, index + 1);
    const project = profile.projects?.[index];
    if (!project) return null;
    const value = projectKind === "summary"
      ? [project.name, project.role, project.description, project.responsibilities].filter(Boolean).join("；")
      : projectKind === "description" ? project.description || project.responsibilities
      : projectKind === "responsibilities" ? project.responsibilities || project.description
      : project[projectKind];
    return matchFieldOption(field, value);
  }
  // Broad English tokens often occur inside a different question's label.
  if (/company.?name|employer.?name|school.?name|岗位名称|公司名称|企业名称/.test(haystack)) return null;
  for (const rule of BASIC_FIELD_RULES) {
    if (rule.keys.some((k) => {
      if (k === "name" || k === "city") return new RegExp(`(^|\\W)${k}($|\\W)`, "i").test(haystack);
      return haystack.includes(k.toLowerCase());
    })) {
      const value = rule.get(profile);
      if (!value) continue;
      // A choice field still has to hit one of its own options.
      const matched = matchFieldOption(field, value);
      if (matched) return matched;
    }
  }
  return null;
}

function isNeverGuessField(field) {
  const haystack = fieldHaystack(field);
  return isSplitNameField(field) || NEVER_GUESS_KEYWORDS.some((k) => haystack.includes(k.toLowerCase()));
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

function portalContext(rawUrl) {
  const url = new URL(rawUrl);
  const tenant = [...url.searchParams]
    .filter(([key]) => /company|tenant|organization|orgid|brand|recruitment/i.test(key))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  // A company's own site is stable across /apply and /candidate pages.
  // Shared job boards are not company identities: without a tenant id, stay
  // on this exact page path rather than leaking an answer across employers.
  const sharedHost = /(?:^|\.)(?:mokahr\.com|beisen\.com|zhaopin\.com|zhipin\.com|liepin\.com|51job\.com|lagou\.com|nowcoder\.com|shixiseng\.com)$/i.test(url.hostname);
  if (sharedHost && !tenant) return `${url.origin}${url.pathname}`.slice(0, 300);
  return `${url.origin}${tenant ? `?${tenant}` : ""}`.slice(0, 300);
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

  wc.on("did-navigate", () => { lastAiFilled.delete(tab.id); sendTabsState(); });
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
        { label: "在系统浏览器中打开", enabled: /^https?:\/\//i.test(wc.getURL()), click: () => openSafeExternalUrl(wc.getURL()) }
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
  const run = Date.now().toString(36).slice(-4);
  for (let i = 0; i < frames.length; i++) {
    try {
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

async function fillAllFrames(pairs, frameById) {
  const byFrame = new Map();
  for (const p of pairs) {
    const frame = frameById.get(p.id);
    if (!frame) continue;
    if (!byFrame.has(frame)) byFrame.set(frame, []);
    byFrame.get(frame).push(p);
  }
  const filled = [];
  const failed = [];
  for (const [frame, subset] of byFrame) {
    const plain = subset.filter((p) => !/-s\d+$/.test(p.id));
    const custom = subset.filter((p) => /-s\d+$/.test(p.id));
    try {
      if (plain.length) {
        const result = await frame.executeJavaScript(`(${fillFields.toString()})(${JSON.stringify(plain)})`);
        filled.push(...result.filled);
        failed.push(...result.failed);
      }
      if (custom.length) {
        const result = await frame.executeJavaScript(`(${fillCustomSelects.toString()})(${JSON.stringify(custom)})`);
        filled.push(...result.filled);
        failed.push(...result.failed);
      }
    } catch {
      failed.push(...subset.map((p) => p.label || p.id));
    }
  }
  return { filled, failed };
}

async function uploadResumeFiles(wc, filePath) {
  let candidates = 0;
  for (const frame of allFrames(wc)) {
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
    for (const node of targets) {
      await dbg.sendCommand("DOM.setFileInputFiles", { files: [filePath], backendNodeId: node.backendNodeId });
    }
    return targets.length;
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
      const r = await frame.executeJavaScript(`(${countFillableFields.toString()})()`);
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

  handle("browser:set-bounds", (_e, rect) => {
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

  handle("browser:autofill", async (_e, resumeVersionId) => {
    const tab = activeTab();
    if (!tab) return;
    const wc = tab.view.webContents;
    const initialUrl = wc.getURL();
    try {
      send("browser:autofill-status", { phase: "scanning", message: "正在读取页面…" });

      const profileRes = await fetch(`http://localhost:${port}/api/desktop-browser/profile`);
      if (!profileRes.ok) throw new Error("拿不到你的资料，先去账号设置填一下");
      const profile = await profileRes.json();

      const { fields, frameById } = await scanAllFrames(wc);
      // A page may only contain an upload control. Keep going when a resume
      // is selected so the attachment pass below still gets a chance to run.
      if (fields.length === 0 && !resumeVersionId) throw new Error("这个页面上没找到可以填的表单——如果表单在弹窗里，先把它打开");

      const pairs = [];
      const candidates = []; // fields going to AI: {id, label, kind, options?}
      const projectIndexes = new Map();
      let neverGuessCount = 0;
      let alreadyFilled = 0;
      for (const field of fields) {
        if (field.hasValue) {
          // A prefilled first project still occupies row one. Otherwise the
          // next empty "项目名称" would incorrectly receive project one again.
          const projectKind = projectFieldKind(fieldHaystack(field));
          if (projectKind) projectIndexes.set(projectKind, (projectIndexes.get(projectKind) || 0) + 1);
          alreadyFilled++;
          continue;
        }
        if (isNeverGuessField(field)) {
          neverGuessCount++;
          continue;
        }
        const value = matchBasicField(field, profile, projectIndexes);
        if (value) {
          pairs.push({ id: field.id, value, source: "profile", label: field.label, tag: field.tag });
          continue;
        }
        const label = field.label || field.placeholder || field.name;
        if (!label) continue; // nothing to even describe this field to the AI with
        if (field.tag === "textarea") {
          candidates.push({ id: field.id, label, kind: "essay" });
        } else if (field.tag === "select" || field.tag === "radio") {
          candidates.push({ id: field.id, label, kind: "choice", options: field.options || [] });
        } else if (field.tag === "custom-select") {
          // Options aren't known until it's opened — ask for a plain value
          // and let fillCustomSelects match it against what appears.
          candidates.push({ id: field.id, label, kind: "short" });
        } else {
          candidates.push({ id: field.id, label, kind: "short" });
        }
      }
      const basicCount = pairs.length;

      let aiError = null;
      if (candidates.length > 0 && !resumeVersionId) {
        aiError = "没选简历，这些字段跳过了";
      } else if (candidates.length > 0) {
        send("browser:autofill-status", {
          phase: "ai",
          message: `已填 ${basicCount} 个基础字段，正在用 AI 补全 ${candidates.length} 个字段…`,
        });
        try {
          const pageContext = portalContext(initialUrl);
          const answerRes = await fetch(`http://localhost:${port}/api/desktop-browser/answer-questions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ questions: candidates, resumeVersionId, profile, contextKey: pageContext }),
          });
          if (answerRes.ok) {
            const { answers } = await answerRes.json();
            const kindById = new Map(candidates.map((c) => [c.id, c.kind]));
            for (const a of answers || []) {
              const kind = kindById.get(a.id);
              const isSentinel = a.answer.trim().toUpperCase() === NEEDS_MANUAL_INPUT;
              if (isSentinel || /简历里没有相关信息|需要自己填/.test(a.answer)) continue;
              const field = fields.find((f) => f.id === a.id);
              if (!field || !kind) continue;
              pairs.push({ id: a.id, value: a.answer, source: a.remembered ? "remembered" : "ai", label: field.label || field.placeholder || field.name, tag: field.tag, answerId: a.answerId, reused: a.reused, remembered: a.remembered });
            }
          } else {
            const body = await answerRes.json().catch(() => ({}));
            aiError = body.error || "AI 生成失败";
          }
        } catch {
          aiError = "AI 生成失败";
        }
      }

      if (wc.isDestroyed() || wc.getURL() !== initialUrl || activeId !== tab.id) throw new Error("页面或标签已切换，已停止写入；请在当前页面重新填充");
      const { filled, failed } = await fillAllFrames(pairs, frameById);
      const filledSet = new Set(filled);
      const rememberedDrafts = pairs.filter((p) => p.source !== "profile" && p.answerId && filledSet.has(p.id) && isOpenEndedQuestionField(fields.find((f) => f.id === p.id) || p))
        .map((p) => ({ id: p.id, answerId: p.answerId, label: p.label, filledValue: p.value }));
      const newIds = new Set(rememberedDrafts.map((draft) => draft.answerId));
      lastAiFilled.set(tab.id, [...(lastAiFilled.get(tab.id) || []).filter((draft) => !newIds.has(draft.answerId)), ...rememberedDrafts]);
      const basicFilled = pairs.filter((p) => p.source === "profile" && filledSet.has(p.id)).length;
      const essayFilled = pairs.filter((p) => p.tag === "textarea" && p.source !== "profile" && filledSet.has(p.id)).length;
      const shortFilled = filled.length - basicFilled - essayFilled;
      const rememberedFilled = pairs.filter((p) => p.remembered && filledSet.has(p.id)).length;
      const essayReused = pairs.filter((p) => p.tag === "textarea" && p.reused && filledSet.has(p.id)).length;
      const aiReused = essayReused - rememberedFilled;
      const details = fields.map((field) => ({
        label: field.label || field.placeholder || field.name || "未命名字段",
        state: field.hasValue ? "已有内容" : isNeverGuessField(field) ? "需要手填" : filledSet.has(field.id)
          ? pairs.find((p) => p.id === field.id)?.remembered ? "复用你的回答" : "已填入" : "未填入",
      }));
      let uploadedResumeCount = 0;
      let uploadError = null;
      if (resumeVersionId) {
        try {
          const fileRes = await fetch(
            `http://localhost:${port}/api/desktop-browser/resume-file?resumeVersionId=${encodeURIComponent(resumeVersionId)}`
          );
          if (fileRes.ok) {
            const file = await fileRes.json();
            uploadedResumeCount = await uploadResumeFiles(wc, file.path);
          } else {
            const body = await fileRes.json().catch(() => ({}));
            uploadError = body.error || "简历附件上传失败";
          }
        } catch (err) {
          uploadError = err && err.message ? err.message : "简历附件上传失败";
        }
      }
      // Whatever this page looked like, it's handled — don't re-prompt for it.
      for (const frame of allFrames(wc)) {
        const r = await frame.executeJavaScript(`(${countFillableFields.toString()})()`).catch(() => null);
        if (r) markFormSettled(tab.id, r.signature);
      }
      formWatch.lastSignature.delete(tab.id);

      const parts = [`已验证填入 ${basicFilled} 个基础字段`];
      if (essayFilled > 0) {
        const fresh = essayFilled - essayReused;
        const bits = [];
        if (rememberedFilled > 0) bits.push(`${rememberedFilled} 道复用了你的回答`);
        if (aiReused > 0) bits.push(`${aiReused} 道复用了 AI 草稿`);
        if (fresh > 0) bits.push(`${fresh} 道新生成`);
        parts.push(`${essayFilled} 道问答题已填（${bits.join("，")}）`);
      }
      if (shortFilled > 0) {
        parts.push(`AI 从简历里补全了 ${shortFilled} 个其他字段`);
      }
      if (uploadedResumeCount > 0) parts.push(`已上传简历附件到 ${uploadedResumeCount} 个位置`);
      if (uploadError) parts.push(uploadError);
      if (alreadyFilled > 0) parts.push(`${alreadyFilled} 个已有内容的字段没动`);
      if (failed.length > 0) {
        parts.push(`${failed.length} 个字段未通过写入验证（${failed.slice(0, 3).join("、")}${failed.length > 3 ? "…" : ""}），需要手填`);
      }
      if (neverGuessCount > 0) {
        parts.push(`${neverGuessCount} 个需核对的姓名拆分或敏感字段，没有自动填`);
      }
      const attempted = filled.length + neverGuessCount + alreadyFilled + failed.length;
      const stillManual = fields.length - attempted;
      if (stillManual > 0) {
        parts.push(
          aiError
            ? `${stillManual} 个字段没能自动填（${aiError}）`
            : `${stillManual} 个字段简历里没有对应信息，需要自己填`
        );
      }
      parts.push("自己修改或写完开放题后，点「记住本页回答」；可在账号设置查看和修改；提交前检查标出的字段");

      send("browser:autofill-status", { phase: "done", message: parts.join("；"), details });
    } catch (err) {
      send("browser:autofill-status", {
        phase: "error",
        message: err && err.message ? err.message : "自动填充失败",
      });
    }
  });

  // Remember essays the user wrote from scratch or changed after AI fill.
  handle("browser:save-corrections", async (_e, resumeVersionId) => {
    const tab = activeTab();
    if (!tab || !resumeVersionId) return { saved: 0 };
    const filledList = lastAiFilled.get(tab.id) || [];
    const answers = [];
    // A fresh scan also includes answers the user wrote entirely by hand.
    // Read the original AI ids first; scanning replaces the temporary DOM ids.
    const { fields, frameById } = await scanAllFrames(tab.view.webContents);
    for (const field of fields) {
      const label = field.label || field.placeholder || field.name;
      if (!isOpenEndedQuestionField(field) || !label || isNeverGuessField(field)) continue;
      const frame = frameById.get(field.id);
      if (!frame) continue;
      const values = await frame.executeJavaScript(`(${readFieldValues.toString()})(${JSON.stringify([field.id])})`).catch(() => ({}));
      const snapshot = values[field.id] || {};
      // A field copied from saved facts isn't a newly confirmed answer, and
      // an unchanged AI draft stays unconfirmed even after another autofill.
      const candidate = memoryCandidate(snapshot, filledList);
      if (!candidate) continue;
      answers.push({ questionLabel: label, answer: candidate.value, answerId: candidate.answerId, kind: field.tag === "textarea" ? "essay" : "short" });
    }
    if (!answers.length) return { saved: 0 };

    const res = await fetch(`http://localhost:${port}/api/desktop-browser/save-corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resumeVersionId, contextKey: portalContext(tab.view.webContents.getURL()), answers }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "保存回答失败");
    const body = await res.json();
    const confirmedIds = new Set(answers.map((answer) => answer.answerId).filter(Boolean));
    lastAiFilled.set(tab.id, filledList.filter((entry) => !confirmedIds.has(entry.answerId)));
    return { saved: body.saved ?? answers.length };
  });
}

module.exports = { setupBrowserViewIpc };
