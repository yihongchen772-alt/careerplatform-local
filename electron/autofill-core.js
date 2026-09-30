// Shared 网申 autofill engine: used by the desktop app's embedded browser
// (electron/browser-view.js) and bundled into the Chrome extension
// (scripts/build-extension.cjs), so both fill forms exactly the same way.
// Plain JavaScript with no module imports: the extension loads this file as-is.

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
    // 8, not fewer: an AntD date picker with a "至今" checkbox beside it sits
    // seven wrappers below its .ant-form-item-label.
    while (container && depth < 8) {
      const cls = (container.className || "").toString().toLowerCase();
      if (/form-item|form-group|field|form-row|input-group|form-cell|form-control-wrap|el-form/.test(cls)) {
        // A label wrapping its own checkbox ("至今") belongs to that checkbox.
        const explicit = Array.from(container.querySelectorAll("label, .ant-form-item-label, .el-form-item__label, [class*='label']"))
          .find((node) => !node.contains(el) && !node.querySelector("input, select, textarea"));
        if (explicit) {
          const text = (explicit.textContent || "").trim();
          if (text && text.length < 40) return text;
        }
        const candidates = container.querySelectorAll("label, span, div, p");
        for (const node of candidates) {
          if (node === el || node.contains(el) || el.contains(node)) continue;
          // Skip other controls' own text: a "至今" checkbox, a range "-".
          if (node.querySelector("input, select, textarea") || node.closest("label")?.querySelector("input, select, textarea")) continue;
          const text = (node.textContent || "").trim();
          if (text && text.length < 40 && /[\p{L}\p{N}]/u.test(text)) return text;
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

  // Repeated blocks (教育经历 ×2, 实习经历 ×3…) reuse the same "学校"/"开始时间"
  // labels; the nearest block heading tells the matcher which list and, for
  // "本科阶段"/"硕士阶段" style headings, which row. Sibling blocks that contain
  // their own inputs are skipped so row two never inherits row one's heading.
  const SECTION_HEADING = /教育|学习经历|本科|硕士|研究生|博士|大专|专科|实习|工作经历|工作经验|实践经历|社会实践|项目|第\s*[一二三四五六七八九十\d]+\s*段|education|academic|internship|employment|work experience|project/i;
  function sectionFor(el) {
    let node = el;
    let depth = 0;
    while (node && node !== document.body && depth < 12) {
      let sibling = node.previousElementSibling;
      let textHops = 0;
      let scanned = 0;
      // Sibling field rows don't count toward the hop budget: a heading can
      // sit above eight form items in the same block.
      while (sibling && textHops < 4 && scanned < 40) {
        if (!sibling.matches("input, select, textarea, button, label") && !sibling.querySelector("input, select, textarea")) {
          const text = (sibling.textContent || "").replace(/\s+/g, " ").trim();
          if (text && text.length <= 30 && SECTION_HEADING.test(text)) return text;
          if (text) textHops++;
        }
        sibling = sibling.previousElementSibling;
        scanned++;
      }
      node = node.parentElement;
      depth++;
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
      section: sectionFor(container),
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
      results.push({ id, tag: "radio", type: "radio", label: group.label, placeholder: "", name: el.getAttribute("name") || "", section: sectionFor(group.radios[0]), options: group.options, hasValue: group.hasValue });
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
      section: sectionFor(el),
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
// Injected: a copy of this frame's DOM with every personal value removed, for
// turning "this site fills wrong" into a regression fixture. Field values and
// checked/selected state are dropped, links and media are blanked, and any
// text or attribute containing one of `secrets` (the user's own profile
// values) or an email/phone/ID-shaped number is replaced.
function snapshotFormStructure(secrets) {
  const needles = (secrets || []).filter(Boolean).sort((a, b) => b.length - a.length);
  const redact = (value) => {
    let out = String(value);
    for (const needle of needles) out = out.split(needle).join("[已隐藏]");
    return out
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[邮箱]")
      .replace(/\d{17}[\dXx]/g, "[证件号]")
      .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[手机号]");
  };
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll("script, style, noscript, svg, img, video, audio, canvas, link, iframe, object, embed").forEach((node) => {
    node.replaceWith(document.createComment(" removed " + node.tagName.toLowerCase() + " "));
  });
  clone.querySelectorAll("input, textarea, option").forEach((el) => {
    el.removeAttribute("value");
    el.removeAttribute("checked");
    el.removeAttribute("selected");
    if (el.tagName === "TEXTAREA") el.textContent = "";
  });
  // Component-library dropdowns show the chosen value as plain text.
  clone.querySelectorAll(".ant-select-selection-item, .el-select__selected-item, .ant-select-selection-item-content, .el-tag, .ant-upload-list").forEach((el) => { el.textContent = "[已选内容]"; });
  clone.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || (attr.name.startsWith("data-cp-") && attr.name !== "data-cp-fill-id")) el.removeAttribute(attr.name);
      else if (/^(?:href|src|srcset|action|poster)$/i.test(attr.name)) el.setAttribute(attr.name, "#");
      else if (attr.name === "style") el.setAttribute("style", attr.value.replace(/url\([^)]*\)/gi, "none"));
      else el.setAttribute(attr.name, redact(attr.value));
    }
  });
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = redact(node.nodeValue);
  return { url: location.origin + location.pathname, title: redact(document.title), html: clone.innerHTML.slice(0, 3000000) };
}

// Every profile value worth hiding in a shared snapshot. Short generic words
// (本科, 男, 汉族) stay: they're option lists the fixture needs, not identity.
function profileSecrets(profile) {
  const values = new Set();
  const add = (value, force) => {
    const text = String(value || "").trim();
    if (text && (force || text.length >= 4) && text.length <= 300) values.add(text);
  };
  add(profile.name, true);
  add(profile.phone, true);
  add(profile.email, true);
  for (const key of ["birthDate", "school", "hometown", "currentCity", "major", "english", "latestCompany", "latestRole"]) add(profile[key]);
  for (const row of [...(profile.education || []), ...(profile.experiences || []), ...(profile.projects || [])]) {
    for (const value of Object.values(row || {})) add(value);
  }
  for (const memory of profile.fieldMemories || []) add(memory.answer);
  return [...values];
}

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
  const skipped = [];
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

  // Component-library date pickers keep the typed text only once they
  // commit it: Enter plus a real blur (React listens for focusout, which a
  // synthetic "blur" event never produces).
  const PICKER = ".ant-picker, .el-date-editor, .el-range-editor, .arco-picker, .ivu-date-picker, .t-date-picker, [class*='date-picker'], [class*='datepicker']";
  const UNTIL_NOW_TEXT = /至今|目前|在读|在职|present|current|till now|to date/i;
  const pickerDone = new Set();

  // "至今" on an end date is almost always a checkbox/switch beside it, not
  // text the picker would accept. Nearest wrapper first, so a second block's
  // end date never ticks the first block's box.
  function tickUntilNow(el, source) {
    let scope = el.parentElement;
    for (let depth = 0; scope && depth < 5; depth++, scope = scope.parentElement) {
      const toggles = Array.from(scope.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]'));
      const toggle = toggles.find((node) => UNTIL_NOW_TEXT.test(((node.closest("label") || node.parentElement || node).textContent || "") + " " + (node.getAttribute("aria-label") || "")));
      if (!toggle) continue;
      const isOn = () => toggle.checked === true || toggle.getAttribute("aria-checked") === "true";
      if (!isOn()) (toggle.closest("label") || toggle).click();
      if (!isOn()) return false;
      mark(toggle.closest("label") || toggle, source);
      return true;
    }
    return false;
  }

  for (const p of pairs) {
    if (!p.value || pickerDone.has(p.id)) continue;
    if (/-r\d+$/.test(p.id)) {
      // radio group (ids are "<frame>-r<n>", fields are "<frame>-f<n>"):
      // click the option whose label matches
      const radios = Array.from(document.querySelectorAll('[data-cp-fill-id^="' + p.id + ':"]'));
      if (radios.some((r) => r.checked || r.getAttribute("data-cp-user-edited") === "1")) {
        skipped.push(p.id);
        continue;
      }
      const target = radios.find((r) => {
        const wrapping = r.closest("label");
        const text = ((wrapping ? wrapping.textContent : r.nextSibling && r.nextSibling.textContent) || r.value || "").trim();
        return text === p.value;
      });
      if (!target || target.disabled) { failed.push(p.label || p.id); continue; }
      target.click();
      if (!target.checked) { failed.push(p.label || p.id); continue; }
      mark(target.closest("label") || target, p.source || "profile", p.answerId);
      filled.push(p.id);
      continue;
    }
    const el = document.querySelector('[data-cp-fill-id="' + p.id + '"]');
    if (!el || (p.tag && el.tagName.toLowerCase() !== p.tag) || el.disabled || el.readOnly) {
      failed.push(p.label || p.id);
      continue;
    }
    if ((el.value && String(el.value).trim()) || el.getAttribute("data-cp-user-edited") === "1") {
      skipped.push(p.id);
      continue;
    }
    const tag = el.tagName.toLowerCase();
    const picker = tag === "input" ? el.closest(PICKER) : null;
    if (p.value === "至今" && (picker || el.type === "date" || el.type === "month")) {
      if (tickUntilNow(el, p.source || "profile")) filled.push(p.id);
      else failed.push(p.label || p.id);
      continue;
    }
    if (picker) {
      // A range picker (开始 + 结束 in one widget) throws away a half-typed
      // range on blur, so both of its inputs are typed before it loses focus.
      const group = Array.from(picker.querySelectorAll("input")).map((input) => {
        const id = input.getAttribute("data-cp-fill-id");
        const pair = input === el ? p : pairs.find((other) => other.id === id && other.value && other.value !== "至今");
        if (pair && ((input.value && String(input.value).trim()) || input.getAttribute("data-cp-user-edited") === "1")) {
          pickerDone.add(pair.id);
          skipped.push(pair.id);
          return null;
        }
        return pair && !input.disabled && !input.readOnly ? { input, pair } : null;
      }).filter(Boolean);
      for (const { input, pair } of group) {
        pickerDone.add(pair.id);
        // A background tab may not take real focus; the synthetic focusin /
        // focusout pair reaches React's and Vue's listeners either way.
        input.focus();
        input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        nativeInputSetter.call(input, pair.value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      const last = group[group.length - 1].input;
      last.blur();
      last.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      for (const { input, pair } of group) {
        if (input.value !== pair.value) { failed.push(pair.label || pair.id); continue; }
        mark(picker, pair.source || "profile", pair.answerId);
        // Memory reads the input itself, not the outlined wrapper.
        if ((pair.source || "profile") === "profile") input.setAttribute("data-cp-profile-filled", "1");
        filled.push(pair.id);
      }
      continue;
    }
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
  return { filled, failed, skipped };
}

// Opens each custom dropdown, reads whatever options it renders, clicks the
// best match for the wanted value, and closes it again if nothing fits.
// Async because these libraries render the option list on the next tick.
async function fillCustomSelects(pairs) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const filled = [];
  const failed = [];
  const skipped = [];
  function hasExistingValue(container) {
    const shown = container.querySelector(".ant-select-selection-item, .el-select__selected-item:not(.el-select__placeholder), .el-select__tags");
    const input = container.matches("input") ? container : container.querySelector("input[readonly]");
    return !!((shown?.textContent || "").trim() || (input?.value || "").trim()) ||
      container.getAttribute("data-cp-user-edited") === "1" || !!container.querySelector('[data-cp-user-edited="1"]');
  }
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
  function pickOne(options, value) {
    const v = String(value).trim();
    return (
      options.find((o) => optionText(o) === v) ||
      options.find((o) => optionText(o).includes(v)) ||
      options.find((o) => v.includes(optionText(o)) && optionText(o).length >= 2) ||
      null
    );
  }
  // `alternatives` carries synonyms such as 学士 → 本科 for degree dropdowns.
  function pick(options, p) {
    for (const value of [p.value, ...(p.alternatives || [])]) {
      const found = pickOne(options, value);
      if (found) return found;
    }
    return null;
  }
  function mark(el, source) {
    el.setAttribute("data-cp-filled", source);
    el.style.setProperty("outline", (source === "ai" ? "2px solid #d946ef" : source === "remembered" ? "2px solid #16a34a" : "2px solid #8b5cf6"), "important");
    el.style.setProperty("outline-offset", "1px", "important");
  }
  for (const p of pairs) {
    const container = document.querySelector('[data-cp-fill-id="' + p.id + '"]');
    if (!container || !p.value) continue;
    if (container.classList.contains("ant-select-disabled") || container.classList.contains("is-disabled") || container.getAttribute("aria-disabled") === "true" || container.disabled) {
      failed.push(p.label || p.id);
      continue;
    }
    if (hasExistingValue(container)) { skipped.push(p.id); continue; }
    // Innermost first: a click on the inner input bubbles up through the
    // wrapper/selector, so every library's own handler sees it.
    const trigger = container.querySelector("input:not([type='hidden'])") || container.querySelector(".ant-select-selector, .el-select__wrapper") || container;
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger.click();
    await sleep(350);
    if (hasExistingValue(container)) { skipped.push(p.id); continue; }
    let options = visibleOptions();
    let target = pick(options, p);
    // Searchable selects (and virtual lists that only render a screenful):
    // type the value to narrow the list, then look again.
    const searchInput = container.querySelector("input:not([readonly]):not([type='hidden'])");
    if (!target && searchInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(searchInput, String(p.value));
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(450);
      if (hasExistingValue(container)) { skipped.push(p.id); continue; }
      options = visibleOptions();
      target = pick(options, p);
      if (!target) {
        setter.call(searchInput, "");
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    if (target) {
      // Verify against the option actually chosen: "北京" picked for 北京市 or
      // "本科" picked for 学士 is a correct fill, not a failed one.
      const wanted = optionText(target);
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      target.click();
      await sleep(150);
      const shown = container.querySelector(".ant-select-selection-item, .el-select__selected-item, .el-select__tags");
      const visibleValue = (shown?.textContent || container.querySelector("input[readonly]")?.value || "").trim();
      if (visibleValue && (visibleValue === wanted || visibleValue.includes(wanted) || visibleValue.includes(String(p.value).trim()))) {
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
  return { filled, failed, skipped };
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

// Installed inside each guest frame. Only real user input marks a field for
// automatic memory; our own fillFields dispatches synthetic events and never
// confirms an AI draft by accident.
function trackUserEdits() {
  if (document.__cpUserEditTrackerInstalled) return;
  document.__cpUserEditTrackerInstalled = true;
  const mark = (event) => {
    if (!event.isTrusted) return;
    const el = event.target;
    if (!el || !el.matches || !el.matches('textarea, select, input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="date"], input[type="month"], input[type="url"], input[type="radio"], input:not([type])')) return;
    if (el.disabled || el.readOnly) return;
    el.setAttribute("data-cp-user-edited", "1");
    el.setAttribute("data-cp-user-edited-at", String(Date.now()));
  };
  document.addEventListener("input", mark, true);
  document.addEventListener("change", mark, true);
}

function hasUserEditedFields() {
  return !!document.querySelector('[data-cp-user-edited="1"]');
}

// Read side of fillFields — same element lookup and same "select reads by
// visible option text" rule, so a value read back here compares cleanly
// against what fillFields originally wrote.
function readFieldValues(ids) {
  const result = {};
  ids.forEach((id) => {
    const radio = Array.from(document.querySelectorAll('[data-cp-fill-id^="' + id + ':"]'));
    if (radio.length) {
      const selected = radio.find((el) => el.checked);
      const label = selected && (selected.closest("label")?.textContent || selected.nextSibling?.textContent || selected.value || "");
      result[id] = { value: (label || "").trim(), answerId: null, profileFilled: radio.some((el) => el.getAttribute("data-cp-profile-filled") === "1"), userEdited: radio.some((el) => el.getAttribute("data-cp-user-edited") === "1"), editedAt: Math.max(...radio.map((el) => Number(el.getAttribute("data-cp-user-edited-at")) || 0)) };
      return;
    }
    const el = document.querySelector('[data-cp-fill-id="' + id + '"]');
    if (!el) return;
    if (el.tagName.toLowerCase() === "select") {
      const selected = el.options[el.selectedIndex];
      result[id] = { value: selected ? selected.textContent.trim() : "", answerId: el.getAttribute("data-cp-answer-id"), profileFilled: el.getAttribute("data-cp-profile-filled") === "1", userEdited: el.getAttribute("data-cp-user-edited") === "1", editedAt: Number(el.getAttribute("data-cp-user-edited-at")) || 0 };
    } else {
      result[id] = { value: el.value, answerId: el.getAttribute("data-cp-answer-id"), profileFilled: el.getAttribute("data-cp-profile-filled") === "1", userEdited: el.getAttribute("data-cp-user-edited") === "1", editedAt: Number(el.getAttribute("data-cp-user-edited-at")) || 0 };
    }
  });
  return result;
}

function clearSavedUserEdits(saved) {
  for (const item of saved) {
    const radios = Array.from(document.querySelectorAll('[data-cp-fill-id^="' + item.id + ':"]'));
    if (radios.length) {
      const selected = radios.find((el) => el.checked);
      const value = String(selected && (selected.closest("label")?.textContent || selected.nextSibling?.textContent || selected.value || "") || "").trim();
      if (value === item.value) radios.forEach((el) => { el.removeAttribute("data-cp-user-edited"); el.removeAttribute("data-cp-user-edited-at"); });
      continue;
    }
    const el = document.querySelector('[data-cp-fill-id="' + item.id + '"]');
    const value = el?.tagName.toLowerCase() === "select" ? el.options[el.selectedIndex]?.textContent.trim() : el?.value;
    if (el && String(value || "").trim() === item.value) {
      el.removeAttribute("data-cp-user-edited");
      el.removeAttribute("data-cp-user-edited-at");
    }
  }
}

function memoryCandidate(snapshot, filledList, onlyUserEdited = false) {
  if (onlyUserEdited && (!snapshot.userEdited || !snapshot.editedAt || Date.now() - snapshot.editedAt < 2500)) return null;
  if (snapshot.profileFilled && !snapshot.userEdited) return null;
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
  // School/major/degree/GPA/dates are per education row — see
  // resolveRepeatField below. Only the page-wide "最高学历" stays flat.
  { keys: ["最高学历", "highest degree", "highest education"], get: (p) => highestEducation(p)?.degree, degree: true },
  { keys: ["英语", "外语", "cet", "english", "语言能力"], get: (p) => p.english },
  { keys: ["政治面貌", "politic"], get: (p) => p.politics },
  { keys: ["籍贯", "户籍", "户口所在地", "hometown"], get: (p) => p.hometown },
  { keys: ["民族", "ethnic"], get: (p) => p.ethnicity },
  { keys: ["现居", "现住", "所在城市", "常住"], get: (p) => p.currentCity },
  { keys: ["意向城市", "期望城市", "工作城市", "city"], get: (p) => p.preferredCities },
  // 资料方案 fields: the direction-specific target role and self-assessment.
  { keys: ["期望岗位", "期望职位", "意向岗位", "意向职位", "求职意向"], get: (p) => p.targetRole },
  { keys: ["自我评价", "个人评价", "自我描述"], get: (p) => p.selfIntro },
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

function isSensitiveMemoryField(field) {
  return /身份证|证件|护照|银行卡|银行账号|卡号|密码|验证码|手机号|电话号码|邮箱地址|电子邮箱|详细地址|家庭住址|通讯地址|紧急联系人|家庭成员|出生日期|birth.?date|passport|password|captcha|bank.?account|phone.?number|email.?address|home.?address/i.test(fieldHaystack(field));
}

// Ordinary contact/education details can be remembered, but credentials,
// identity numbers and payment details never enter the reusable library.
function isForbiddenMemoryField(field) {
  return /身份证|证件(?:号|号码)|护照|签名|密码|验证码|银行卡|银行账号|卡号|信用卡|支付|社保号|税号|紧急联系人|家庭成员|passport|password|captcha|bank.?account|credit.?card|social.?security|verification.?code|one.?time.?code/i.test(fieldHaystack(field));
}

function fieldMemoryKey(field) {
  const raw = String(field.label || field.placeholder || field.name || "").trim();
  const label = raw.replace(/[＊*：:\s]+/g, " ").trim().toLowerCase();
  if (!label || isForbiddenMemoryField(field)) return null;
  if (/^(?:姓名|真实姓名|full name|name)$/.test(label)) return "姓名";
  if (/^(?:学校|毕业院校|院校|school|university|school name)$/.test(label)) return "学校";
  if (/^(?:手机|手机号|电话|电话号码|联系电话|phone|mobile|mobile phone|phone number|tel)$/.test(label)) return "手机";
  if (/^(?:邮箱|电子邮箱|邮箱地址|email|email address|e-mail)$/.test(label)) return "邮箱";
  if (/^(?:地址|详细地址|通讯地址|联系地址|现住址|家庭住址|address|mailing address|home address)$/.test(label)) return "地址";
  if (/^(?:专业|所学专业|major)$/.test(label)) return "专业";
  if (/^(?:学历|最高学历|degree|education level)$/.test(label)) return "学历";
  if (/^(?:性别|gender)$/.test(label)) return "性别";
  if (/^(?:出生日期|出生年月|生日|date of birth|birth date)$/.test(label)) return "出生日期";
  // Unknown labels stay portal-local: do not reuse an employer-specific field
  // on another company's site just because its wording happens to match.
  return raw.slice(0, 500);
}

function matchRememberedField(field, memories, contextKey) {
  if (isForbiddenMemoryField(field)) return null;
  const key = fieldMemoryKey(field);
  if (!key) return null;
  const matches = (memories || []).filter((item) => item.questionLabel === key && (!item.contextKey || item.contextKey === contextKey));
  const selected = matches.find((item) => item.contextKey === contextKey) || matches.find((item) => !item.contextKey);
  return selected ? matchFieldOption(field, selected.answer) : null;
}

// Education, internship and project blocks repeat on most 网申 forms with
// identical labels. Every such field is classified as {group, kind} and takes
// the next row of that list, so the second "学校" gets the second education
// row instead of the first one again.
const DEGREE_LEVELS = [
  [4, /博士|doctor|ph\.?d/i],
  [3, /硕士|研究生|master|postgrad|mba/i],
  [2, /本科|学士|bachelor|undergrad/i],
  [1, /大专|专科|高职|associate/i],
];

function degreeLevel(text) {
  const value = String(text || "");
  for (const [level, pattern] of DEGREE_LEVELS) if (pattern.test(value)) return level;
  return 0;
}

const CHINESE_ORDINALS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function sectionOrdinal(section) {
  const match = /第\s*([一二三四五六七八九十]|\d+)\s*段|(?:经历|背景|信息|education|experience|project)\s*[（(#]?\s*(\d+)\s*[)）]?$/i.exec(section);
  const raw = match && (match[1] || match[2]);
  const n = raw ? CHINESE_ORDINALS[raw] || Number(raw) : 0;
  return n > 0 && n <= 20 ? n - 1 : null;
}

function sectionGroup(section) {
  if (/项目|project/i.test(section)) return "project";
  if (/实习|工作经历|工作经验|实践经历|社会实践|internship|employment|work experience/i.test(section)) return "experience";
  if (/教育|学习经历|本科|硕士|研究生|博士|大专|专科|education|academic/i.test(section)) return "education";
  return null;
}

// Label alone, without "*"/"：" decoration — generic block labels such as
// "名称"/"开始时间" are only trusted when they are the whole label.
function bareLabel(field) {
  return String(field.label || field.placeholder || "").replace(/^请(?:输入|选择|填写)/, "").replace(/[＊*：:\s]+/g, "").toLowerCase();
}

// One box holding the whole span ("起止时间: 2021.09 - 2025.06"). Only trusted
// as the entire label inside a block, or for 在校时间-style education labels.
const RANGE_LABEL = /^(?:起止(?:时间|日期|年月)?|起讫(?:时间|日期)?|时间段|时间范围|在校时间|就读时间|在读时间|实习时间|工作时间|任职时间|项目时间|时间|period|duration|dates?)$/i;

const START_LABEL = /开始|起始|入学|入职(?:时间|日期|年月)|start|(?:^|\W)from(?:\W|$)/i;
const END_LABEL = /结束|截止|毕业(?:时间|年份|年月|日期)|离职(?:时间|日期|年月)|graduation|(?:^|\W)end(?:\W|$)|end.?date|(?:^|\W)to(?:\W|$)/i;
// "离职原因" / "开始工作的契机" are questions about a date, not the date.
const NOT_A_DATE = /原因|理由|说明|契机|部门|证明|方式/;

function educationFieldKind(haystack, inSection, bare = "") {
  if (/英语|外语|cet|toefl|ielts|托福|雅思|语言/i.test(haystack)) return null;
  if (/最高学历|highest/i.test(haystack)) return null;
  if (/学校|院校|school|university|college/i.test(haystack)) return /城市|所在地|地区|省份|类型|性质|层次|排名|city|type|rank/i.test(haystack) ? null : "school";
  if (/专业|major|field of study/i.test(haystack)) return /技能|证书|资格|排名|方向|课程|实践|能力/.test(haystack) ? null : "major";
  if (/学历|学位|degree|education.?level/i.test(haystack)) return "degree";
  if (/gpa|绩点|平均分|平均成绩|学习成绩|加权/i.test(haystack)) return /排名|rank/i.test(haystack) ? null : "gpa";
  if (NOT_A_DATE.test(haystack)) return null;
  if (/入学/.test(haystack) || (inSection && START_LABEL.test(haystack))) return "start";
  if (/毕业(?:时间|年份|年月|日期)|graduation/i.test(haystack) || (inSection && END_LABEL.test(haystack))) return "end";
  if (/^(?:在校时间|就读时间|在读时间)$/.test(bare) || (inSection && RANGE_LABEL.test(bare))) return "range";
  return null;
}

function experienceFieldKind(haystack, inSection, bare = "") {
  if (/实习(?:单位|公司|企业|机构)|工作单位|任职(?:单位|公司)/.test(haystack)) return "company";
  if (!inSection) return null;
  if (/公司|单位|企业|机构|company|employer|organi[sz]ation/i.test(haystack)) return "company";
  if (/职位|岗位|职务|角色|title|position|role/i.test(haystack)) return "role";
  if (START_LABEL.test(haystack) && !NOT_A_DATE.test(haystack)) return "start";
  if (END_LABEL.test(haystack) && !NOT_A_DATE.test(haystack)) return "end";
  if (RANGE_LABEL.test(bare)) return "range";
  if (/描述|内容|职责|业绩|成果|description|responsibilit|achievement/i.test(haystack)) return "description";
  return null;
}

function projectFieldKind(haystack, bare = "", inSection = false) {
  if (/项目(?:名称|名)(?!称)|project[\s_-]*(?:name|title)/i.test(haystack)) return "name";
  if (/项目(?:角色|职位)|project[\s_-]*role/i.test(haystack)) return "role";
  if (/项目(?:开始|起始)|project[\s_-]*start/i.test(haystack)) return "start";
  if (/项目(?:结束|截止)|project[\s_-]*end/i.test(haystack)) return "end";
  if (/项目(?:职责|负责|贡献|成果)|project[\s_-]*(?:responsibilit|contribution|achievement)/i.test(haystack)) return "responsibilities";
  if (/项目(?:描述|简介|介绍|内容)|project[\s_-]*(?:description|summary|overview)/i.test(haystack)) return "description";
  if (/项目经历|project[\s_-]*experience/i.test(haystack)) return "summary";
  if (!inSection) return null;
  if (/^(?:名称|name|title)$/.test(bare)) return "name";
  if (/^(?:角色|担任角色|职务|role)$/.test(bare)) return "role";
  if (/^(?:开始(?:时间|日期)?|起始(?:时间|日期)?|start(?:date)?)$/.test(bare)) return "start";
  if (/^(?:结束(?:时间|日期)?|截止(?:时间|日期)?|end(?:date)?)$/.test(bare)) return "end";
  if (RANGE_LABEL.test(bare)) return "range";
  if (/职责|负责|贡献|成果|responsibilit|achievement/.test(bare)) return "responsibilities";
  if (/描述|简介|介绍|内容|description/.test(bare)) return "description";
  return null;
}

// Classifies a field and consumes its row. `rowIndexes` counts rows per
// "group:kind" across the whole scan (prefilled fields included), so it must
// be called once for every scanned field, in page order.
function resolveRepeatField(field, rowIndexes) {
  if (isSplitNameField(field)) return null;
  const haystack = fieldHaystack(field);
  const section = String(field.section || "");
  const group = sectionGroup(section);
  const bare = bareLabel(field);
  let info = null;
  const projectKind = projectFieldKind(haystack, bare, group === "project");
  if (projectKind) info = { group: "project", kind: projectKind };
  if (!info && group === "experience") {
    const kind = experienceFieldKind(haystack, true, bare);
    if (kind) info = { group: "experience", kind };
  }
  if (!info) {
    const kind = educationFieldKind(haystack, group === "education", bare);
    if (kind) info = { group: "education", kind };
  }
  if (!info) {
    const kind = experienceFieldKind(haystack, false);
    if (kind) info = { group: "experience", kind };
  }
  if (!info) return null;
  // A stray "预计毕业时间" in 基本信息 must not push the education blocks
  // below it down a row, so in-block and loose fields count separately.
  const key = `${info.group}:${info.kind}:${group === info.group ? "in" : "out"}`;
  const counted = rowIndexes?.get(key) || 0;
  rowIndexes?.set(key, counted + 1);
  const ordinal = sectionOrdinal(section);
  // The degree field's own label ("学历（本科及以上）") is a requirement, not a row.
  const hint = info.group === "education" ? degreeLevel(`${info.kind === "degree" ? "" : field.label || ""} ${group === "education" ? section : ""}`) : 0;
  return { ...info, row: ordinal ?? counted, degreeHint: hint };
}

// Highest degree first (the order most forms and resume extraction use),
// unless a row's degree is unreadable — then the user's own order stands.
function educationRows(profile) {
  const saved = (profile.education || []).filter((row) => row && Object.values(row).some(Boolean));
  const rows = saved.length ? saved.map((row) => ({ ...row })) : [{
    school: profile.school || "",
    major: profile.major || "",
    degree: profile.degree || "",
    gpa: profile.gpa || "",
    start: profile.educationStart || "",
    end: profile.educationEnd || "",
  }];
  if (rows.length > 1 && rows.every((row) => degreeLevel(row.degree))) {
    rows.sort((a, b) => degreeLevel(b.degree) - degreeLevel(a.degree));
  }
  rows[0].school = rows[0].school || profile.school || "";
  rows[0].end = rows[0].end || (profile.graduationYear ? String(profile.graduationYear) : "");
  return rows.filter((row) => Object.values(row).some(Boolean));
}

function highestEducation(profile) {
  return educationRows(profile)[0] || null;
}

const DEGREE_SYNONYMS = {
  4: ["博士", "博士研究生", "博士学位", "PhD", "Doctor"],
  3: ["硕士", "硕士研究生", "研究生", "硕士学位", "Master"],
  2: ["本科", "学士", "大学本科", "本科/学士", "Bachelor"],
  1: ["大专", "专科", "高职", "Associate"],
};

// Custom dropdowns only reveal their options once opened in the page, so the
// synonyms travel with the value and fillCustomSelects tries each in turn.
function degreeAlternatives(field, value) {
  if (field.tag !== "custom-select" || !/学历|学位|degree|education/i.test(fieldHaystack(field))) return undefined;
  return DEGREE_SYNONYMS[degreeLevel(value)]?.filter((item) => item !== value);
}

function matchDegreeOption(field, value) {
  if (!value) return null;
  const level = degreeLevel(value);
  if (field.options && level) {
    const sameLevel = field.options.filter((option) => degreeLevel(option) === level);
    return sameLevel.find((option) => option === value) || sameLevel.find((option) => option.includes(value)) || sameLevel[0] || null;
  }
  return matchFieldOption(field, value);
}

const UNTIL_NOW = /^(?:至今|今|现在|目前|在读|在职|present|now|current|ongoing)$/i;

function dateParts(raw) {
  const m = /(\d{4})(?:\s*[-./年]\s*(\d{1,2}))?(?:\s*[-./月]\s*(\d{1,2}))?/.exec(String(raw || ""));
  return m ? { y: m[1], m: m[2] ? m[2].padStart(2, "0") : "", d: m[3] ? m[3].padStart(2, "0") : "" } : null;
}

// What a date field expects: its own example ("2020.09"), a format string
// ("YYYY-MM-DD"), its input type, or its wording (选择日期 → day, 月份 → month,
// 毕业年份 → year). Unknown fields keep yyyy-MM, the profile's own format.
function dateFormatFor(field) {
  const hint = `${field.placeholder || ""} ${field.label || ""}`;
  // (?!\d): in "2020.09-2024.06" the "-20" is the next year, not a day.
  const sample = /\d{4}\s*([-./年])\s*\d{1,2}(?:\s*([-./月])\s*\d{1,2}(?!\d))?/.exec(hint);
  if (sample) return { precision: sample[2] ? "day" : "month", sep: sample[1] };
  const pattern = /y{4}\s*([-./年])\s*m{2}(?:\s*[-./月]\s*d{2})?/i.exec(hint);
  if (pattern) return { precision: /d{2}/i.test(pattern[0]) ? "day" : "month", sep: pattern[1] };
  if (field.type === "date") return { precision: "day", sep: "-" };
  if (field.type === "month") return { precision: "month", sep: "-" };
  if (/年份|(?:^|\W)year(?:\W|$)/i.test(hint)) return { precision: "year", sep: "-" };
  if (/月份|年月|month/i.test(hint)) return { precision: "month", sep: "-" };
  if (/日期|date/i.test(hint)) return { precision: "day", sep: "-" };
  return { precision: "month", sep: "-" };
}

function formatDateForField(field, raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (UNTIL_NOW.test(value)) return "至今";
  const parts = dateParts(value);
  if (!parts) return value;
  const format = dateFormatFor(field);
  if (format.precision === "year") return parts.y;
  // A bare year can't become a month without inventing one.
  if (!parts.m) return field.type === "date" || field.type === "month" ? "" : parts.y;
  // The profile keeps yyyy-MM; a field that wants a full date gets the 1st.
  const day = parts.d || "01";
  if (format.sep === "年") return `${parts.y}年${parts.m}月${format.precision === "day" ? `${day}日` : ""}`;
  return [parts.y, parts.m, ...(format.precision === "day" ? [day] : [])].join(format.sep);
}

// "2021.09 - 2025.06" in one box, following the field's own example joiner.
function dateRangeValue(field, start, end) {
  if (field.type === "date" || field.type === "month") return "";
  const text = { ...field, type: "text" };
  const from = formatDateForField(text, start);
  const to = formatDateForField(text, end);
  if (!from || !to) return "";
  const joiner = /\d\s*(~|～|至|—|–|-)\s*(?:\d{4}|至今)/.exec(field.placeholder || "")?.[1];
  const separator = joiner ? (joiner === "至" ? " 至 " : ` ${joiner} `) : dateFormatFor(text).sep === "-" ? " 至 " : " - ";
  return `${from}${separator}${to}`;
}

function rowDateValue(field, kind, row) {
  if (kind === "range") return dateRangeValue(field, row.start, row.end);
  if (kind === "start" || kind === "end") return formatDateForField(field, row[kind]);
  return row[kind];
}

function repeatFieldValue(field, info, profile) {
  if (info.group === "project") {
    const project = profile.projects?.[info.row];
    if (!project) return null;
    const value = ["start", "end", "range"].includes(info.kind) ? rowDateValue(field, info.kind, project) : info.kind === "summary"
      ? [project.name, project.role, project.description, project.responsibilities].filter(Boolean).join("；")
      : info.kind === "description" ? project.description || project.responsibilities
      : info.kind === "responsibilities" ? project.responsibilities || project.description
      : project[info.kind];
    return matchFieldOption(field, value);
  }
  if (info.group === "experience") {
    const experience = (profile.experiences || [])[info.row];
    return experience ? matchFieldOption(field, rowDateValue(field, info.kind, experience)) : null;
  }
  const rows = educationRows(profile);
  // "本科院校" must never receive the 硕士 row just because it came first.
  const row = info.degreeHint ? rows.find((item) => degreeLevel(item.degree) === info.degreeHint) : rows[info.row];
  if (!row) return null;
  return info.kind === "degree" ? matchDegreeOption(field, row.degree) : matchFieldOption(field, rowDateValue(field, info.kind, row));
}

// One line per scanned field for the 逐字段结果 list: where the value came
// from, so checking a filled form means reading the AI and 需手填 rows, not
// every field. `source` drives the colour dot and grouping in the UI.
function fillDetail(field, pair, filledSet, failedSet) {
  const own = field.label || field.placeholder || field.name || "未命名字段";
  const label = field.section && !own.includes(field.section) && sectionGroup(field.section) ? `${field.section} · ${own}` : own;
  if (field.hasValue) return { label, state: "页面已有内容，未改动", source: "prefilled" };
  if (pair && filledSet.has(field.id)) {
    if (pair.source === "profile") return { label, state: "来自网申资料", source: "profile" };
    if (pair.source === "remembered-field") return { label, state: "来自记忆库", source: "memory" };
    if (pair.remembered) return { label, state: "复用你确认过的回答", source: "memory" };
    return { label, state: pair.reused ? "AI 草稿（复用），请核对" : "AI 生成，请核对", source: "ai" };
  }
  if (isNeverGuessField(field)) return { label, state: "敏感或需核对，请手填", source: "manual" };
  if (pair && failedSet.has(pair.label || pair.id)) return { label, state: "写入没成功，请手填", source: "manual" };
  return { label, state: "没有对应资料，请手填", source: "manual" };
}

// "有 2 段教育经历，页面只有 1 组" — most portals render one empty block and
// hide the rest behind an 添加 button, which autofill deliberately never clicks.
function missingRepeatCounts(profile, rowIndexes) {
  const seen = (group, kind) => Math.max(rowIndexes.get(`${group}:${kind}:in`) || 0, rowIndexes.get(`${group}:${kind}:out`) || 0);
  const checks = [
    ["education", "school", educationRows(profile).length, "教育经历"],
    ["experience", "company", (profile.experiences || []).length, "实习/工作经历"],
    ["project", "name", (profile.projects || []).length, "项目经历"],
  ];
  return checks
    .map(([group, kind, saved, label]) => ({ group, label, saved, shown: seen(group, kind) }))
    .filter(({ saved, shown }) => shown > 0 && saved > shown);
}

function missingRepeatBlocks(profile, rowIndexes) {
  return missingRepeatCounts(profile, rowIndexes).map(({ saved, shown, label }) => `有 ${saved} 段${label}、页面只有 ${shown} 组`);
}

// Injected: clicks the page's own "添加教育经历 / + 新增" button for one list.
// Only short button-like labels starting with 添加/新增/增加 count, and the
// button (or the block heading it sits under) must name the list, so an
// "添加附件" or another section's "+ 添加" is never pressed. Reports whether a
// modal opened, because a modal block has to be saved by the applicant before
// the next one can be added.
async function clickAddBlock(group) {
  const GROUP_WORDS = {
    education: /教育|学历|学习经历|education/i,
    experience: /实习|工作经历|工作经验|实践|internship|work experience|employment/i,
    project: /项目|project/i,
  };
  const words = GROUP_WORDS[group];
  const ADD = /^[+＋]?\s*(?:添加|新增|增加|继续添加|再添加|add\b)/i;
  const visible = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
  const context = (el) => {
    let node = el;
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
      let sibling = node.previousElementSibling;
      for (let hops = 0; sibling && hops < 6; hops++, sibling = sibling.previousElementSibling) {
        const text = (sibling.textContent || "").replace(/\s+/g, " ").trim();
        if (text && text.length <= 30 && !sibling.querySelector("input, select, textarea")) return text;
      }
    }
    return "";
  };
  const candidates = Array.from(document.querySelectorAll("button, a, [role='button'], .ant-btn, .el-button, span, div"))
    .filter((el) => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 16 || !ADD.test(text) || !visible(el)) return false;
      // Innermost element carrying the text; its clickable ancestor is used below.
      if (Array.from(el.children).some((child) => ADD.test((child.textContent || "").trim()))) return false;
      return words.test(text) || words.test(context(el));
    })
    .map((el) => el.closest("button, a, [role='button'], .ant-btn, .el-button") || el);
  const target = candidates.find((el) => !el.disabled && el.getAttribute("aria-disabled") !== "true");
  if (!target) return { clicked: false };
  target.scrollIntoView({ block: "center" });
  target.click();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const modal = Array.from(document.querySelectorAll(".ant-modal-wrap, .el-dialog__wrapper, .el-overlay-dialog, [role='dialog'][aria-modal='true']")).some(visible);
  return { clicked: true, text: (target.textContent || "").trim().slice(0, 20), modal };
}

// Long-text kinds may still go to the AI when the saved row lacks them. Short
// facts (school, dates, company) only do when nothing is saved for that list
// and it's the first block — the AI can't tell which row a second "学校" means
// and would repeat the first one.
function repeatFieldGoesToAi(info, profile) {
  if (info.kind === "description" || info.kind === "responsibilities" || info.kind === "summary") return true;
  const saved = info.group === "education" ? educationRows(profile) : info.group === "experience" ? profile.experiences || [] : profile.projects || [];
  return saved.length === 0 && info.row === 0 && !info.degreeHint;
}

function matchFieldOption(field, value) {
  if (!value) return null;
  if (!field.options) return value;
  return field.options.find((option) => option === value) ||
    field.options.find((option) => option.includes(value) || value.includes(option)) || null;
}

function matchFlatField(field, profile) {
  const haystack = fieldHaystack(field);
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
      const matched = rule.degree ? matchDegreeOption(field, value) : matchFieldOption(field, value);
      if (matched) return matched;
    }
  }
  return null;
}

function matchBasicField(field, profile, rowIndexes) {
  // A saved full name cannot safely be split into first/last/given/family
  // names (especially for bilingual forms). Leave these for the applicant.
  if (isSplitNameField(field)) return null;
  const repeat = resolveRepeatField(field, rowIndexes);
  if (repeat) return repeatFieldValue(field, repeat, profile);
  return matchFlatField(field, profile);
}

function isNeverGuessField(field) {
  const haystack = fieldHaystack(field);
  return isSplitNameField(field) || NEVER_GUESS_KEYWORDS.some((k) => haystack.includes(k.toLowerCase()));
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


// Injected (extension only): attaches the resume to the inputs that
// markResumeFileInputs tagged. Chrome extensions can't pass a local path the
// way Electron's CDP does, so the bytes arrive base64-encoded and become a
// File set through DataTransfer — the same thing a drag-and-drop produces.
function attachResumeFile(base64, filename, mimeType) {
  const inputs = Array.from(document.querySelectorAll('input[type="file"][data-cp-resume-upload="1"]'));
  if (!inputs.length) return 0;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  let attached = 0;
  for (const input of inputs) {
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], filename, { type: mimeType || "application/octet-stream" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (input.files && input.files.length) attached++;
  }
  return attached;
}

// Injected (extension only, top frame): the extension's progress/result box.
// The popup closes as soon as the applicant clicks into the page, so the
// outcome is shown on the page itself, in a shadow root the site's CSS can't
// restyle. `payload` is the same {phase, message, details} status object.
function showPageStatus(payload) {
  const HOST_ID = "jobcompass-autofill-status";
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
    host.attachShadow({ mode: "open" });
    document.documentElement.appendChild(host);
  }
  const root = host.shadowRoot;
  root.textContent = "";
  const style = document.createElement("style");
  style.textContent = ".box{box-sizing:border-box;width:340px;max-height:60vh;overflow:auto;padding:12px 14px;border-radius:12px;background:#fff;color:#1f2328;border:1px solid #d0d7de;box-shadow:0 8px 24px rgba(0,0,0,.18);font:13px/1.55 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif}.error{border-color:#f5a3a3;background:#fff5f5}.head{display:flex;justify-content:space-between;gap:8px;font-weight:600;margin-bottom:4px}.close{cursor:pointer;border:0;background:none;font-size:16px;line-height:1;color:#57606a}ul{margin:6px 0 0;padding-left:18px}li{margin:1px 0}.manual{margin-top:6px;color:#b42318}";
  const box = document.createElement("div");
  box.className = "box" + (payload.phase === "error" ? " error" : "");
  const head = document.createElement("div");
  head.className = "head";
  const title = document.createElement("span");
  title.textContent = payload.phase === "done" ? "求职罗盘 · 填写完成" : payload.phase === "error" ? "求职罗盘 · 没能填写" : "求职罗盘 · 填写中…";
  const close = document.createElement("button");
  close.className = "close";
  close.textContent = "×";
  close.addEventListener("click", () => host.remove());
  head.append(title, close);
  const message = document.createElement("div");
  message.textContent = payload.message || "";
  box.append(head, message);
  const manual = (payload.details || []).filter((item) => item.source === "manual");
  if (manual.length) {
    const note = document.createElement("div");
    note.className = "manual";
    note.textContent = `需要你手填（${manual.length}）：`;
    const list = document.createElement("ul");
    for (const item of manual.slice(0, 12)) {
      const li = document.createElement("li");
      li.textContent = item.label;
      list.appendChild(li);
    }
    box.append(note, list);
  }
  root.append(style, box);
  return true;
}

// ---- orchestration (shared by the desktop browser and the extension) ----
//
// `adapter` hides where the page lives:
//   url()                    current page URL
//   stillOnPage(initialUrl)  false once the page navigated or the tab changed
//   frames()                 Promise<frame handle[]>, top frame first
//   run(frame, fn, args)     run a self-contained page function in one frame
//   api(name, init)          fetch one of the app's autofill endpoints
//                            ("profile?…", "answer-questions", "save-corrections")
//   status(payload)          progress / result for the UI
//   uploadResume(id)         attach the chosen resume; resolves to #inputs filled
//   getDrafts() / setDrafts(list)   AI drafts filled on this tab (for memory)
//   onFilled()               optional hook after a fill

async function scanFrames(adapter) {
  const frames = await adapter.frames();
  const fields = [];
  const frameById = new Map();
  const run = Date.now().toString(36).slice(-4);
  for (let i = 0; i < frames.length; i++) {
    try {
      await adapter.run(frames[i], trackUserEdits, []);
      const found = await adapter.run(frames[i], scanPageFields, [`c${i}${run}-`]);
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

async function fillFrames(adapter, pairs, frameById) {
  const byFrame = new Map();
  for (const p of pairs) {
    const frame = frameById.get(p.id);
    if (frame === undefined) continue;
    if (!byFrame.has(frame)) byFrame.set(frame, []);
    byFrame.get(frame).push(p);
  }
  const filled = [];
  const failed = [];
  const skipped = [];
  for (const [frame, subset] of byFrame) {
    const plain = subset.filter((p) => !/-s\d+$/.test(p.id));
    const custom = subset.filter((p) => /-s\d+$/.test(p.id));
    try {
      if (plain.length) {
        const result = await adapter.run(frame, fillFields, [plain]);
        filled.push(...result.filled);
        failed.push(...result.failed);
        skipped.push(...(result.skipped || []));
      }
      if (custom.length) {
        const result = await adapter.run(frame, fillCustomSelects, [custom]);
        filled.push(...result.filled);
        failed.push(...result.failed);
        skipped.push(...(result.skipped || []));
      }
    } catch {
      failed.push(...subset.map((p) => p.label || p.id));
    }
  }
  return { filled, failed, skipped };
}

// `options`: { variantId, expandBlocks } from the UI, plus round/modal/added
// carried between 自动补齐栏目 rounds.
async function runAutofillCore(adapter, resumeVersionId, options = {}) {
  const initialUrl = adapter.url();
  try {
    adapter.status({ phase: "scanning", message: "正在读取页面…" });

    const profileQuery = new URLSearchParams({ contextKey: portalContext(initialUrl) });
    if (options.variantId) profileQuery.set("variantId", options.variantId);
    if (resumeVersionId) profileQuery.set("resumeVersionId", resumeVersionId);
    const profileRes = await adapter.api(`profile?${profileQuery}`);
    if (!profileRes.ok) throw new Error("拿不到你的资料，先去求职罗盘的账号设置填一下");
    const profile = await profileRes.json();

    const { fields, frameById } = await scanFrames(adapter);
    // A page may only contain an upload control. Keep going when a resume
    // is selected so the attachment pass below still gets a chance to run.
    if (fields.length === 0 && !resumeVersionId) throw new Error("这个页面上没找到可以填的表单——如果表单在弹窗里，先把它打开");

    const pairs = [];
    const candidates = []; // fields going to AI: {id, label, kind, options?}
    const rowIndexes = new Map();
    const pageContext = portalContext(initialUrl);
    let neverGuessCount = 0;
    let alreadyFilled = 0;
    for (const field of fields) {
      // Classify before skipping prefilled fields: a filled first education
      // block still occupies row one, so the next empty "学校" gets row two.
      const repeat = resolveRepeatField(field, rowIndexes);
      if (field.hasValue) {
        alreadyFilled++;
        continue;
      }
      // Saved 网申资料 rows are the source of truth for repeated blocks. A
      // remembered "学校" is one value and would otherwise fill every row.
      const structured = repeat ? repeatFieldValue(field, repeat, profile) : null;
      if (structured) {
        pairs.push({ id: field.id, value: structured, source: "profile", label: field.label, tag: field.tag, alternatives: degreeAlternatives(field, structured) });
        continue;
      }
      const rememberedValue = repeat && (repeat.row > 0 || repeat.degreeHint) ? null : matchRememberedField(field, profile.fieldMemories, pageContext);
      if (rememberedValue) {
        pairs.push({ id: field.id, value: rememberedValue, source: "remembered-field", label: field.label, tag: field.tag, remembered: true });
        continue;
      }
      if (isNeverGuessField(field)) {
        neverGuessCount++;
        continue;
      }
      if (repeat && !repeatFieldGoesToAi(repeat, profile)) continue;
      const value = repeat ? null : matchFlatField(field, profile);
      if (value) {
        pairs.push({ id: field.id, value, source: "profile", label: field.label, tag: field.tag, alternatives: degreeAlternatives(field, value) });
        continue;
      }
      const label = field.label || field.placeholder || field.name;
      if (!label) continue; // nothing to even describe this field to the AI with
      if (field.tag === "textarea") {
        candidates.push({ id: field.id, label, kind: "essay" });
      } else if (field.tag === "select" || field.tag === "radio") {
        candidates.push({ id: field.id, label, kind: "choice", options: field.options || [] });
      } else {
        // custom-select options aren't known until opened — ask for a plain
        // value and let fillCustomSelects match it against what appears.
        candidates.push({ id: field.id, label, kind: "short" });
      }
    }
    const basicCount = pairs.length;

    let aiError = null;
    if (candidates.length > 0 && !resumeVersionId) {
      aiError = "没选简历，这些字段跳过了";
    } else if (candidates.length > 0) {
      adapter.status({ phase: "ai", message: `已匹配 ${basicCount} 个基础字段，正在用 AI 生成 ${candidates.length} 个字段的内容…` });
      try {
        const answerRes = await adapter.api("answer-questions", {
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

    if (!adapter.stillOnPage(initialUrl)) throw new Error("页面或标签已切换，已停止写入；请在当前页面重新填充");
    const { filled, failed, skipped } = await fillFrames(adapter, pairs, frameById);
    const filledSet = new Set(filled);
    const rememberedDrafts = pairs.filter((p) => p.source !== "profile" && p.source !== "remembered-field" && p.answerId && filledSet.has(p.id) && isOpenEndedQuestionField(fields.find((f) => f.id === p.id) || p))
      .map((p) => ({ id: p.id, answerId: p.answerId, label: p.label, filledValue: p.value }));
    const newIds = new Set(rememberedDrafts.map((draft) => draft.answerId));
    adapter.setDrafts([...adapter.getDrafts().filter((draft) => !newIds.has(draft.answerId)), ...rememberedDrafts]);
    const basicFilled = pairs.filter((p) => (p.source === "profile" || p.source === "remembered-field") && filledSet.has(p.id)).length;
    const essayFilled = pairs.filter((p) => p.tag === "textarea" && p.source !== "profile" && p.source !== "remembered-field" && filledSet.has(p.id)).length;
    const shortFilled = filled.length - basicFilled - essayFilled;
    const rememberedFilled = pairs.filter((p) => p.tag === "textarea" && p.source !== "remembered-field" && p.remembered && filledSet.has(p.id)).length;
    const essayReused = pairs.filter((p) => p.tag === "textarea" && p.reused && filledSet.has(p.id)).length;
    const aiReused = essayReused - rememberedFilled;
    const failedSet = new Set(failed);
    const skippedSet = new Set(skipped);
    const details = fields.map((field) => skippedSet.has(field.id)
      ? { label: field.label || field.placeholder || field.name || "未命名字段", state: "填写期间已有修改，已保留", source: "prefilled" }
      : fillDetail(field, pairs.find((p) => p.id === field.id), filledSet, failedSet));
    let uploadedResumeCount = 0;
    let uploadError = null;
    if (resumeVersionId) {
      try {
        uploadedResumeCount = await adapter.uploadResume(resumeVersionId);
      } catch (err) {
        uploadError = err && err.message ? err.message : "简历附件上传失败";
      }
    }
    if (adapter.onFilled) await adapter.onFilled();

    const parts = [`已验证填入 ${basicFilled} 个基础字段${profile.variantName ? `（资料方案「${profile.variantName}」）` : ""}`];
    if (essayFilled > 0) {
      const fresh = essayFilled - essayReused;
      const bits = [];
      if (rememberedFilled > 0) bits.push(`${rememberedFilled} 道复用了你的回答`);
      if (aiReused > 0) bits.push(`${aiReused} 道复用了 AI 草稿`);
      if (fresh > 0) bits.push(`${fresh} 道新生成`);
      parts.push(`${essayFilled} 道问答题已填（${bits.join("，")}）`);
    }
    if (shortFilled > 0) parts.push(`AI 从简历里补全了 ${shortFilled} 个其他字段`);
    if (uploadedResumeCount > 0) parts.push(`已上传简历附件到 ${uploadedResumeCount} 个位置`);
    if (uploadError) parts.push(uploadError);
    // After an 添加 round the earlier rounds' own fills count as "已有内容".
    if (alreadyFilled > 0 && !options.round) parts.push(`${alreadyFilled} 个已有内容的字段没动`);
    if (skipped.length > 0) parts.push(`${skipped.length} 个填写期间已有修改的字段已保留`);
    if (failed.length > 0) {
      parts.push(`${failed.length} 个字段未通过写入验证（${failed.slice(0, 3).join("、")}${failed.length > 3 ? "…" : ""}），需要手填`);
    }
    if (neverGuessCount > 0) parts.push(`${neverGuessCount} 个需核对的姓名拆分或敏感字段，没有自动填`);
    const attempted = filled.length + neverGuessCount + alreadyFilled + failed.length + skipped.length;
    const stillManual = fields.length - attempted;
    if (stillManual > 0) {
      parts.push(aiError ? `${stillManual} 个字段没能自动填（${aiError}）` : `${stillManual} 个字段简历里没有对应信息，需要自己填`);
    }
    const added = options.added || [];
    const missing = missingRepeatCounts(profile, rowIndexes);
    const round = options.round || 0;
    if (options.expandBlocks && missing.length && round < 4 && !options.modal && adapter.stillOnPage(initialUrl)) {
      const clicked = [];
      let modal = false;
      for (const { group, label } of missing) {
        for (const frame of await adapter.frames()) {
          const result = await adapter.run(frame, clickAddBlock, [group]).catch(() => null);
          if (result && result.clicked) {
            clicked.push(label);
            modal = modal || result.modal;
            break;
          }
        }
        if (modal) break;
      }
      if (clicked.length) {
        adapter.status({ phase: "scanning", message: `已点页面上的「添加」补出 ${clicked.join("、")}，继续填写…` });
        return runAutofillCore(adapter, resumeVersionId, { ...options, round: round + 1, modal, added: [...added, ...clicked] });
      }
    }
    if (added.length) {
      const counts = added.reduce((map, label) => map.set(label, (map.get(label) || 0) + 1), new Map());
      parts.unshift(`已自动添加 ${[...counts].map(([label, n]) => `${n} 组${label}`).join("、")}`);
      if (options.modal) parts.push("新栏目在弹窗里：核对后点弹窗的保存，再点一次一键填写继续下一段");
    }
    const missingBlocks = missingRepeatBlocks(profile, rowIndexes);
    if (missingBlocks.length) {
      parts.push(options.expandBlocks
        ? `网申资料里${missingBlocks.join("、")}，没找到能自动点的「添加」按钮——请手动添加后再点一次一键填写`
        : `网申资料里${missingBlocks.join("、")}，但这页的对应栏目不够——先点页面上的「添加」再点一次一键填写，或勾选「自动补齐栏目」`);
    }
    parts.push("手写或修改的基础资料和开放题会自动记住；可在账号设置查看和修改；提交前请核对所有填入内容");

    const result = { phase: "done", message: parts.join("；"), details };
    adapter.status(result);
    return result;
  } catch (err) {
    const result = { phase: "error", message: err && err.message ? err.message : "自动填充失败" };
    adapter.status(result);
    return result;
  }
}

async function frameHasUserEdits(adapter) {
  for (const frame of await adapter.frames()) {
    if (await adapter.run(frame, hasUserEditedFields, []).catch(() => false)) return true;
  }
  return false;
}

// Remember manually entered facts and essays; never save untouched drafts.
async function saveCorrectionsCore(adapter, resumeVersionId, onlyUserEdited = false) {
  const pageUrl = adapter.url();
  if (onlyUserEdited && !(await frameHasUserEdits(adapter))) return { saved: 0 };
  const filledList = adapter.getDrafts();
  const answers = [];
  const savedFields = [];
  // A fresh scan also includes answers the user wrote entirely by hand.
  // Read the original AI ids first; scanning replaces the temporary DOM ids.
  const { fields, frameById } = await scanFrames(adapter);
  const rowIndexes = new Map();
  for (const field of fields) {
    const repeat = resolveRepeatField(field, rowIndexes);
    const label = field.label || field.placeholder || field.name;
    if (!label || isForbiddenMemoryField(field)) continue;
    if (field.tag === "custom-select") continue;
    const frame = frameById.get(field.id);
    if (frame === undefined) continue;
    const values = await adapter.run(frame, readFieldValues, [[field.id]]).catch(() => ({}));
    const snapshot = (values || {})[field.id] || {};
    // A field copied from saved facts isn't a newly confirmed answer, and
    // an unchanged AI draft stays unconfirmed even after another autofill.
    const candidate = memoryCandidate(snapshot, filledList, onlyUserEdited);
    if (!candidate || label.length < 2 || label.length > 500 || candidate.value.length > 10000) continue;
    // An AI-filled field the applicant never typed in is still a draft, even
    // when the draft list is gone (the extension's worker can be suspended,
    // the app restarted) and memoryCandidate can't recognise it.
    if (snapshot.answerId && !snapshot.userEdited) continue;
    const openEnded = isOpenEndedQuestionField(field) && !isSensitiveMemoryField(field);
    if (!openEnded && !snapshot.userEdited) continue;
    // Only the first block may become a reusable "学校"/"项目名称" memory;
    // a second row's school saved under the same key would replace it.
    if (!openEnded && repeat && (repeat.row > 0 || repeat.degreeHint)) continue;
    const key = openEnded ? label : fieldMemoryKey(field);
    if (!key) continue;
    answers.push({ questionLabel: key, answer: candidate.value, answerId: openEnded ? candidate.answerId : undefined, kind: openEnded ? field.tag === "textarea" ? "essay" : "short" : "field" });
    savedFields.push({ frame, id: field.id, value: candidate.value });
  }
  if (!answers.length || adapter.url() !== pageUrl) return { saved: 0 };

  const res = await adapter.api("save-corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumeVersionId, contextKey: portalContext(pageUrl), answers }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "保存回答失败");
  const body = await res.json();
  if (body.saved === answers.length) {
    for (const frame of new Set(savedFields.map((field) => field.frame))) {
      const entries = savedFields.filter((field) => field.frame === frame).map(({ id, value }) => ({ id, value }));
      await adapter.run(frame, clearSavedUserEdits, [entries]).catch(() => {});
    }
    const confirmedIds = new Set(answers.map((answer) => answer.answerId).filter(Boolean));
    adapter.setDrafts(filledList.filter((entry) => !confirmedIds.has(entry.answerId)));
  }
  return { saved: body.saved ?? 0 };
}

module.exports = {
  attachResumeFile,
  showPageStatus,
  fillFrames,
  frameHasUserEdits,
  runAutofillCore,
  saveCorrectionsCore,
  scanFrames,
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
  sectionGroup,
  sectionOrdinal,
  snapshotFormStructure,
  trackUserEdits,
};
