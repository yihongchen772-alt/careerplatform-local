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
function scanPageFields(prefix, readOnly = false) {
  const results = [];
  const nodes = new Map();
  const host = typeof location !== "undefined" ? location.hostname : "";
  // Portal families keep their own wrappers; common DOM rules remain the fallback.
  const portal = /(^|\.)mokahr\.com$/.test(host) ? { name: "Moka", wrapper: /question|formItem|form-item/i, label: "[class*='questionTitle'], [class*='label'], label" }
    : /(^|\.)(zhiye\.com|beisen\.com|italent\.cn)$/.test(host) ? { name: "北森", wrapper: /resume-item|form-item|field|question/i, label: "[class*='field-name'], [class*='label'], label" }
    : /(^|\.)(dayee\.com|hotjob\.cn)$/.test(host) ? { name: "大易", wrapper: /form-group|resume-item|field|item-row/i, label: "[class*='title'], [class*='label'], label" } : null;
  let counter = 0;
  const seenRadioGroups = new Map();
  const radioMembers = new Map();
  const customContainers = new Set();
  // Web-component portals keep their inputs in open shadow roots; those are
  // searched like the page itself, and `order` keeps every control in the
  // order it appears on screen across them.
  const roots = [document];
  const order = new Map();
  let seq = 0;
  (function walk(root) {
    for (const node of root.querySelectorAll("*")) {
      order.set(node, seq++);
      if (node.shadowRoot) { roots.push(node.shadowRoot); walk(node.shadowRoot); }
    }
  })(document);
  const queryAll = (selector) => roots.flatMap((root) => Array.from(root.querySelectorAll(selector)));
  const parentOf = (node) => node.parentElement || (node.parentNode && node.parentNode.host) || null;
  const rootOf = (node) => (node.getRootNode ? node.getRootNode() : document);
  const inside = (ancestor, node) => {
    if (rootOf(ancestor) === rootOf(node) && typeof ancestor.contains === "function") return ancestor.contains(node);
    for (let current = node; current; current = parentOf(current)) if (current === ancestor) return true;
    return false;
  };
  // "姓　　名" (aligned with ideographic spaces on older portals) reads as 姓名.
  const clean = (text) => String(text || "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").replace(/([㐀-鿿]) (?=[㐀-鿿])/g, "$1").trim();
  const PICKER = ".ant-picker, .el-date-editor, .el-range-editor, .arco-picker, .ivu-date-picker, .t-date-picker";
  const SITE_CHROME = "header, nav, footer, [role='banner'], [role='navigation'], [role='contentinfo'], [role='menubar'], [role='toolbar']";
  const OPTION_HOLDER = "[role='radio'], [role='checkbox'], [role='option'], [role='listbox'], [role='radiogroup'], .el-radio-group, .ant-radio-group, .el-checkbox-group, .ant-checkbox-group, .el-select-dropdown, .ant-select-dropdown";
  // Wizard pages keep earlier steps in the DOM, hidden. Their ids from the
  // last scan would collide with this scan's and querySelector would hand
  // the value to the hidden old field — clear them first.
  if (!readOnly) queryAll("[data-cp-fill-id]").forEach((el) => el.removeAttribute("data-cp-fill-id"));
  const elements = queryAll(
    'input[type="text"], input[type="tel"], input[type="email"], input[type="number"], input[type="date"], input[type="month"], input[type="url"], input[type="radio"], input:not([type]), .ant-select-auto-complete input[type="search"], textarea, select'
  );

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  // Styled radio "pills" hide the native input and show its label instead.
  function controlVisible(el) {
    if (isVisible(el)) return true;
    if (el.type !== "radio") return false;
    const label = el.closest("label") || (el.id ? rootOf(el).querySelector('label[for="' + CSS.escape(el.id) + '"]') : null) || el.nextElementSibling;
    return isVisible(label);
  }

  // A radio's own text: its wrapping label, a label[for], or the text right after it.
  function optionLabel(radio) {
    const wrap = radio.closest("label");
    if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
    const byFor = radio.id ? rootOf(radio).querySelector('label[for="' + CSS.escape(radio.id) + '"]') : null;
    if (byFor && clean(byFor.textContent)) return clean(byFor.textContent);
    for (let node = radio.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === 1 && (node.matches("input, select, textarea") || node.querySelector("input, select, textarea"))) break;
      const text = clean(node.textContent);
      if (text) return text;
    }
    return clean(radio.value);
  }

  // Text that belongs to an option (a radio's "男", a dropdown item) is never
  // the question's label.
  function isOptionText(node) {
    return !!node.closest(OPTION_HOLDER) || !!node.closest("label")?.querySelector("input, select, textarea");
  }

  // Component-library forms (Ant Design, Element, and most Chinese
  // enterprise recruiting portals are built on one of these) put the input
  // several DOM levels below its label, as a sibling deep inside a shared
  // "form item" wrapper — a plain previous-sibling walk almost never finds
  // it. Walk up looking for that wrapper, then take the first text-bearing
  // node inside it that isn't the input itself.
  function labelFromFormItem(el) {
    let container = parentOf(el);
    let depth = 0;
    // 10, not fewer: an AntD date picker with a "至今" checkbox beside it sits
    // seven wrappers below its .ant-form-item-label, 飞书招聘's date range nine.
    while (container && depth < 10) {
      const cls = (container.className || "").toString().toLowerCase();
      if (/form-item|formily-item(?![-\w])|form-group|field|form-row|input-group|form-cell|form-control-wrap|el-form/.test(cls) || portal?.wrapper.test(cls)) {
        // A label wrapping its own checkbox ("至今") belongs to that checkbox.
        const explicit = Array.from(container.querySelectorAll(portal?.label || "label, .ant-form-item-label, .el-form-item__label, [class*='label']"))
          .find((node) => !node.contains(el) && !node.querySelector("input, select, textarea") && !isOptionText(node));
        if (explicit) {
          const text = clean(explicit.textContent);
          if (text && text.length < 40) return text;
        }
        const candidates = container.querySelectorAll("label, span, div, p");
        for (const node of candidates) {
          if (node === el || node.contains(el) || el.contains(node)) continue;
          // Skip other controls' own text: a "至今" checkbox, a range "-".
          if (node.querySelector("input, select, textarea") || isOptionText(node)) continue;
          const text = clean(node.textContent);
          if (text && text.length < 40 && /[\p{L}\p{N}]/u.test(text)) return text;
        }
      }
      container = parentOf(container);
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
      const text = clean(prev.textContent);
      if (text && text.length < 40) return text;
      prev = prev.previousElementSibling;
    }
    return "";
  }

  function labelText(node) {
    const copy = node.cloneNode(true);
    copy.querySelectorAll("input, select, textarea, button, [role='combobox'], .ant-select, .el-select").forEach((control) => control.remove());
    return clean(copy.textContent);
  }

  // "<div class=row><div class=title>姓名</div><div class=content><input>":
  // climb while the wrapper only holds this control (or a small 年/月 group)
  // and take the short text right before it.
  function labelFromSiblingRow(el) {
    let node = el;
    for (let depth = 0; node && depth < 4; depth++) {
      for (let sibling = node.previousElementSibling, hops = 0; sibling && hops < 2; sibling = sibling.previousElementSibling, hops++) {
        if (sibling.matches("input, select, textarea, button, script, style") || sibling.querySelector("input, select, textarea, button")) break;
        const text = labelText(sibling);
        // A block heading (<h3>教育经历</h3>) titles the section, not this box.
        if (text && text.length <= 30 && /[\p{L}\p{N}]/u.test(text)) return /^(?:H[1-6]|LEGEND)$/.test(sibling.tagName) ? "" : text;
        if (text) break;
      }
      const parent = parentOf(node);
      if (!parent || parent === document.body) break;
      if (parent.querySelectorAll("input:not([type='hidden']), select, textarea, [contenteditable='true'], [role='combobox'], [role='radiogroup']").length > 3) break;
      node = parent;
    }
    return "";
  }

  function labelFor(el) {
    if (el.id) {
      const byFor = rootOf(el).querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (byFor && labelText(byFor)) return labelText(byFor);
    }
    const wrapping = el.closest("label");
    if (wrapping && labelText(wrapping)) return labelText(wrapping);
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return clean(ariaLabel);
    const ariaLabelledby = el.getAttribute("aria-labelledby");
    if (ariaLabelledby) {
      const text = clean(ariaLabelledby.split(/\s+/).map((id) => rootOf(el).getElementById?.(id) || document.getElementById(id)).filter((node) => node && node !== el).map(labelText).filter(Boolean).join(" "));
      if (text) return text;
    }
    const fromFormItem = labelFromFormItem(el);
    if (fromFormItem) return fromFormItem;
    // 飞书招聘 tags every box with its field's name.
    const fieldName = clean(el.getAttribute("data-form-field-i18n-name"));
    if (fieldName) return fieldName;
    const fromTable = labelFromTable(el);
    if (fromTable) return fromTable;
    const fromRow = labelFromSiblingRow(el);
    // "基本信息" above a box whose placeholder says 姓名: the placeholder is the label.
    const placeholder = clean(el.getAttribute("placeholder") || el.getAttribute("data-placeholder"));
    if (fromRow && !(SECTION_HEADING.test(fromRow) && placeholder && !/^请(?:输入|选择|填写)?$/.test(placeholder))) return fromRow;
    let node = el.previousElementSibling;
    let hops = 0;
    while (node && hops < 3) {
      // Another control's text (a 年 dropdown before a 月 one) is not this label.
      if (node.matches("input, select, textarea, button") || node.querySelector("input, select, textarea")) break;
      const text = clean(node.textContent);
      if (text) return text.slice(0, 60);
      node = node.previousElementSibling;
      hops++;
    }
    return "";
  }

  // Text right after a control in its own cell or form item — where older
  // portals print "格式：2026-07-01" or "如 2020.09" — for date formatting.
  function hintFor(el) {
    const bits = [];
    for (let node = el.nextSibling; node && bits.join(" ").length < 60; node = node.nextSibling) {
      if (node.nodeType === 1 && (node.matches("input, select, textarea, button") || node.querySelector("input, select, textarea"))) break;
      const text = clean(node.textContent);
      if (text) bits.push(text);
    }
    const extra = el.closest(".ant-form-item")?.querySelector(".ant-form-item-extra");
    if (extra) bits.push(clean(extra.textContent));
    return bits.join(" ").slice(0, 80);
  }

  // Repeated blocks (教育经历 ×2, 实习经历 ×3…) reuse the same "学校"/"开始时间"
  // labels; the nearest block heading tells the matcher which list and, for
  // "本科阶段"/"硕士阶段" style headings, which row. Sibling blocks that contain
  // their own inputs are skipped so row two never inherits row one's heading.
  // 家庭成员 / 紧急联系人 headings matter as much: those fields are about
  // someone else and must never receive the applicant's own details.
  const SECTION_HEADING = /基本信息|个人信息|联系方式|求职意向|开放题|问答|补充信息|其他信息|其它信息|附加信息|自我评价|教育|学习经历|本科|硕士|研究生|博士|大专|专科|实习|工作经历|工作经验|实践经历|社会实践|项目|获奖|荣誉|奖项|奖励|校园活动|校园经历|校内经历|在校经历|任职经历|组织经历|校内任职|校内实践|在校实践|学生会|社团经历|社团活动|学生工作|学生干部|语言能力|外语能力|专业技能|技能特长|资格证书|证书情况|获得证书|职业证书|技能证书|培训经历|家庭成员|家庭情况|家庭信息|家庭关系|家庭主要成员|主要家庭成员|紧急联系人|联系人信息|推荐人|证明人|社会关系|亲属|第\s*[一二三四五六七八九十\d]+\s*段|personal information|contact information|questions|education|academic|internship|employment|work experience|project|award|honou?r|emergency contact|family members?|family information|referees?|references/i;
  // A header row holding the title, a one-line description and an 「添加」
  // link reads too long as a whole; its title element is the heading.
  // "项目职务" / "单位名称" beside its box is the box's caption, not a module title.
  const CAPTION_LIKE = /(?:名称|职务|职位|角色|时间|日期|描述|内容|地点|类别|级别|排名|单位|方向|类型|专业|电话|邮箱)[*＊?？：:\s]*$|^是否|[?？]/;
  function headerTitle(node, text) {
    if (!text || text.length > 200) return "";
    return Array.from(node.querySelectorAll("h1, h2, h3, h4, h5, h6, strong, b, [class*='title'], [class*='Title'], [class*='name'], [class*='head']")).map((child) => clean(child.textContent)).find((value) => value && value.length <= 30 && SECTION_HEADING.test(value) && !CAPTION_LIKE.test(value)) || "";
  }
  // Entries the site already saved in this module, shown as text cards next
  // to the one empty form (portals that take one 经历 / 证书 / 语言 at a time).
  // Same walk as sectionFor, but it stops at the module's own heading, so
  // other modules and the page header never count; no heading, no entries.
  const ACTION_ONLY = /^(?:[+＋]?\s*(?:编辑|删除|修改|保存|取消|添加|新增|收起|展开|删除本条记录|删除此条|上移|下移|edit|delete|remove|save|cancel|add)\s*)+$/i;
  function savedEntriesFor(el, captions) {
    const entries = [];
    const look = (sibling) => {
      if (sibling.matches("input, select, textarea, button, label, script, style") || sibling.querySelector("input, select, textarea")) return "";
      // A dropdown's hidden option list is not something the site saved.
      if (sibling.hidden || sibling.matches("[role='listbox'], [role='option'], [role='menu'], [role='tooltip'], [aria-hidden='true'], datalist, template") || !isVisible(sibling)) return "";
      const text = clean(sibling.textContent);
      // A form item's own caption ("证书名称") is neither a heading nor an entry.
      if (!text || captions.has(text.replace(/[*＊：:]/g, ""))) return "";
      if ((text.length <= 30 && SECTION_HEADING.test(text) && !CAPTION_LIKE.test(text)) || headerTitle(sibling, text)) return "heading";
      // Only a saved entry carries its own 编辑 / 删除: that tells it apart
      // from a module's description or tips.
      const editable = /编辑|删除|修改|edit|delete|remove/i.test(text) || !!sibling.querySelector("[class*='edit' i], [class*='delete' i], [class*='remove' i], [title*='编辑'], [title*='删除'], [aria-label*='编辑'], [aria-label*='删除'], [aria-label*='edit' i], [aria-label*='delete' i]");
      const data = text.replace(/删除本条记录|删除此条|编辑|删除|修改|上移|下移/g, " ").replace(/\s+/g, " ").trim();
      if (editable && data.length >= 2 && text.length <= 400 && !ACTION_ONLY.test(text)) entries.push(data);
      return "";
    };
    let node = el;
    for (let depth = 0; node && node !== document.body && depth < 12; depth++, node = parentOf(node)) {
      let heading = false;
      for (let sibling = node.previousElementSibling, scanned = 0; sibling && scanned < 40; sibling = sibling.previousElementSibling, scanned++) {
        if (look(sibling) === "heading") { heading = true; break; }
      }
      // Some portals list the saved ones below the form, up to the next module.
      for (let sibling = node.nextElementSibling, scanned = 0; sibling && scanned < 40; sibling = sibling.nextElementSibling, scanned++) {
        if (look(sibling) === "heading") break;
      }
      if (heading) return entries;
    }
    return [];
  }
  function sectionFor(el) {
    let node = el;
    let depth = 0;
    // 20: 飞书招聘's 教育经历 box sits 17 wrappers below its module title.
    while (node && node !== document.body && depth < 20) {
      let sibling = node.previousElementSibling;
      let textHops = 0;
      let scanned = 0;
      // Sibling field rows don't count toward the hop budget: a heading can
      // sit above eight form items in the same block.
      while (sibling && textHops < 4 && scanned < 40) {
        if (!sibling.matches("input, select, textarea, button, label") && !sibling.querySelector("input, select, textarea")) {
          const text = clean(sibling.textContent);
          if (text && text.length <= 30 && SECTION_HEADING.test(text) && !CAPTION_LIKE.test(text)) return text;
          const title = headerTitle(sibling, text);
          if (title) return title;
          if (text) textHops++;
        }
        sibling = sibling.previousElementSibling;
        scanned++;
      }
      node = parentOf(node);
      depth++;
    }
    return "";
  }

  function commonAncestor(list) {
    let node = parentOf(list[0]);
    while (node && !list.every((item) => inside(node, item))) node = parentOf(node);
    return node || list[0];
  }

  // 性别/政治面貌/是否服从调剂 are radio groups far more often than <select>s
  // on Chinese 网申 forms. One entry per group, options = each radio's own
  // label, filled later by clicking the matching one. Component libraries
  // (Ant Design's Radio.Group) often leave the inputs without a name: those
  // are grouped by their radio-group wrapper instead.
  function radioGroup(el) {
    const name = el.getAttribute("name");
    const box = el.closest("[role='radiogroup'], .ant-radio-group, .el-radio-group, .ivu-radio-group, .arco-radio-group, .t-radio-group, [class*='radio-group'], [class*='radioGroup'], [class*='RadioGroup']");
    const scope = name ? (el.form || rootOf(el)) : box;
    if (!scope) return null;
    if (!seenRadioGroups.has(scope)) seenRadioGroups.set(scope, new Set());
    if (seenRadioGroups.get(scope).has(name || "")) return null;
    seenRadioGroups.get(scope).add(name || "");
    const radios = Array.from(scope.querySelectorAll('input[type="radio"]')).filter((r) => (name ? r.getAttribute("name") === name : !r.getAttribute("name")) && controlVisible(r));
    if (!radios.length) return null;
    const options = radios.map(optionLabel);
    if (options.filter(Boolean).length < 2) return null;
    let label = "";
    const group = box || radios[0].closest("[role='radiogroup']");
    const labelledBy = group?.getAttribute("aria-labelledby");
    if (labelledBy) label = clean(labelledBy.split(/\s+/).map((id) => rootOf(group).getElementById?.(id) || document.getElementById(id)).filter((node) => node && !inside(group, node)).map(labelText).join(" "));
    if (!label && group?.getAttribute("aria-label")) label = clean(group.getAttribute("aria-label"));
    // The group's own label: the shared form item, or the text before the first radio.
    if (!label) label = labelFromFormItem(radios[0]) || labelFromTable(radios[0]);
    if (!label) {
      const legend = radios[0].closest("fieldset")?.querySelector("legend") || radios[0].closest("div, td, li")?.querySelector("legend");
      if (legend) label = clean(legend.textContent);
    }
    // A caption sitting beside the options in the same row ("是否学生干部* ○是 ○否").
    if (!label) {
      const box = commonAncestor(radios);
      const lead = Array.from(box.children || []).find((child) => !radios.some((radio) => inside(child, radio)) && clean(child.textContent));
      if (lead && clean(lead.textContent).length <= 40) label = clean(lead.textContent);
    }
    if (!label) label = labelFromSiblingRow(commonAncestor(radios));
    return { radios, options, label, hasValue: radios.some((r) => r.checked) };
  }

  // What a component-library dropdown currently shows. Element Plus 2.x puts
  // the chosen label in its (no longer transparent) placeholder; Element UI
  // and cascaders in a read-only input; a plain listbox button in its text.
  const PLACEHOLDER_TEXT = /^(?:请|点击|點擊)?(?:选择|选取|输入|填写|搜索)|^(?:select|choose|search|please (?:select|choose|enter))\b|^(?:--|—)/i;
  function ownText(node) {
    if (typeof node.cloneNode !== "function") return "";
    const copy = node.cloneNode(true);
    copy.querySelectorAll("[role='listbox'], [role='option'], [hidden], [aria-hidden='true'], ul, ol, svg, i, style, [class*='placeholder']:not(.el-select__placeholder), .el-select__placeholder.is-transparent").forEach((child) => child.remove());
    return clean(copy.textContent);
  }
  function selectedText(container) {
    const shown = container.querySelector(".ant-select-selection-item, .ud__select__selector__selectItem, .el-select__selected-item:not(.el-select__placeholder):not(.el-select__input-wrapper), .el-select__placeholder:not(.is-transparent), .el-select__tags-text, .el-cascader__tags");
    // Some portals print their prompt ("输入工作单位名称") where the choice goes.
    if (shown && clean(shown.textContent) && !PLACEHOLDER_TEXT.test(clean(shown.textContent))) return clean(shown.textContent);
    // Element UI and cascaders show the choice in a read-only input; Arco,
    // Semi or Fusion keep the input for searching and show it as text.
    const input = container.matches("input") ? container : container.querySelector("input:not([type='hidden'])");
    if (input && clean(input.value) && !PLACEHOLDER_TEXT.test(clean(input.value))) return clean(input.value);
    if (container.matches("input")) return "";
    const text = ownText(container);
    return !/[\p{L}\p{N}]/u.test(text) || PLACEHOLDER_TEXT.test(text) || text === clean(container.getAttribute("placeholder")) || text === clean(input?.getAttribute("placeholder")) ? "" : text;
  }

  // Component-library dropdowns: a div that only becomes a list when
  // clicked (Ant Design .ant-select, Element .el-select, cascaders, and
  // anything using the ARIA combobox/listbox pattern). No options are read
  // here — the fill step opens each one and picks the closest match.
  const customSelectors = ".ant-select, .el-select, .el-cascader, [role='combobox']:not(input):not(select), input[role='combobox'][readonly], input[aria-haspopup='listbox'], button[aria-haspopup='listbox'], [role='button'][aria-haspopup='listbox']";
  queryAll(customSelectors).forEach((el) => {
    // Element Plus date inputs are read-only comboboxes too; they're typed into.
    // A language switcher or site search in the page header is not the form.
    if (el.closest(PICKER) || el.closest(SITE_CHROME)) return;
    const container = el.closest(".ant-select, .el-select, .el-cascader, .ud__select__selector") || el;
    // An AutoComplete accepts free text: its input is filled like any other.
    if (customContainers.has(container) || container.classList.contains("ant-select-auto-complete")) return;
    if (!isVisible(container)) return;
    if (container.classList.contains("ant-select-disabled") || container.classList.contains("is-disabled") || container.getAttribute("aria-disabled") === "true" || container.disabled) return;
    const multiple = container.classList.contains("ant-select-multiple") || container.getAttribute("aria-multiselectable") === "true" || !!container.querySelector(".el-select__tags, .el-cascader__tags");
    if (multiple) return; // never guess multi-selects
    const innerInput = container.matches("input") ? container : container.querySelector("input:not([type='hidden'])");
    const id = prefix + "s" + counter++;
    nodes.set(id, container);
    customContainers.add(container);
    if (!readOnly) container.setAttribute("data-cp-fill-id", id);
    results.push({
      id,
      tag: "custom-select",
      type: "",
      label: labelFor(innerInput || container) || labelFor(container),
      placeholder: clean((innerInput && innerInput.getAttribute("placeholder")) || (container.querySelector(".ant-select-selection-placeholder, .el-select__placeholder") || {}).textContent || ""),
      name: (innerInput && innerInput.getAttribute("name")) || container.id || "",
      section: sectionFor(container),
      hasValue: !!selectedText(container),
      cascader: container.classList.contains("ant-cascader") || container.classList.contains("el-cascader"),
    });
  });

  // ARIA radio groups drawn without native inputs (role=radio divs).
  queryAll("[role='radiogroup']").forEach((group) => {
    if (group.querySelector('input[type="radio"]') || !isVisible(group)) return;
    const choices = Array.from(group.querySelectorAll("[role='radio']")).filter(isVisible);
    if (choices.length < 2) return;
    const id = prefix + "g" + counter++;
    nodes.set(id, group);
    if (!readOnly) group.setAttribute("data-cp-fill-id", id);
    results.push({ id, tag: "radio", type: "radio", label: labelFor(group) || labelFromSiblingRow(group), placeholder: "", name: group.getAttribute("name") || group.id || "", section: sectionFor(group), options: choices.map((choice) => clean(choice.textContent)), hasValue: choices.some((choice) => choice.getAttribute("aria-checked") === "true") });
  });

  // Rich-text boxes (Quill, wangEditor, CKEditor…) for 自我评价 and essays.
  queryAll("[contenteditable='true'], [contenteditable='']").forEach((el) => {
    if (!el.isContentEditable || parentOf(el)?.closest?.("[contenteditable='true'], [contenteditable='']") || !isVisible(el) || el.getBoundingClientRect().height < 20) return;
    const id = prefix + "f" + counter++;
    nodes.set(id, el);
    if (!readOnly) el.setAttribute("data-cp-fill-id", id);
    results.push({ id, tag: "richtext", type: "", label: labelFor(el), placeholder: clean(el.getAttribute("data-placeholder") || el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || ""), name: el.getAttribute("name") || "", section: sectionFor(el), hasValue: !!clean(el.innerText) });
  });

  elements.forEach((el) => {
    if (el.type === "password" || !controlVisible(el) || el.closest(SITE_CHROME)) return;
    const hasValue = !!(el.value && String(el.value).trim());
    if (el.disabled && !hasValue) return;
    // Inner inputs of custom selects were handled above.
    if ([...customContainers].some((container) => container === el || inside(container, el))) return;
    if (el.type === "radio") {
      const group = radioGroup(el);
      if (!group) return;
      const id = prefix + "r" + counter++;
      nodes.set(id, group.radios[0]);
      radioMembers.set(id, group.radios);
      if (!readOnly) group.radios.forEach((r, i) => r.setAttribute("data-cp-fill-id", id + ":" + i));
      results.push({ id, tag: "radio", type: "radio", label: group.label, placeholder: "", name: el.getAttribute("name") || "", section: sectionFor(group.radios[0]), options: group.options, hasValue: group.hasValue });
      return;
    }
    const pickerBox = el.tagName === "INPUT" ? el.closest(PICKER) : null;
    const entry = {
      id: "",
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      label: labelFor(el),
      placeholder: clean(el.getAttribute("placeholder")),
      name: el.getAttribute("name") || "",
      section: sectionFor(el),
      // Already has something in it — the user (or the site) filled it; the
      // autofill leaves those alone rather than overwriting.
      hasValue,
    };
    if (el.readOnly && !hasValue && !pickerBox) {
      // A read-only box that opens the site's own calendar can't be typed
      // into; it is still listed so the result says "pick it on the page".
      if (!/日期|时间|年月|生日|date|birth|calendar/i.test(`${entry.label} ${entry.placeholder} ${entry.name}`)) return;
      entry.readonlyPicker = true;
    }
    if (pickerBox) {
      const kind = /(?:el-date-editor|ant-picker)--?(\w+)/.exec(pickerBox.className || "");
      if (kind) entry.pickerType = kind[1];
    }
    entry.hint = hintFor(el);
    const id = prefix + "f" + counter++;
    entry.id = id;
    nodes.set(id, el);
    if (!readOnly) el.setAttribute("data-cp-fill-id", id);
    if (entry.tag === "select") {
      const selected = el.options[el.selectedIndex];
      const placeholder = !selected?.value || /^(?:请(?:选择|选取)|please\s*(?:select|choose)|select\s*(?:one|an?\b)|choose\s*(?:one|an?\b)|[-—]+\s*(?:请选择|select))/i.test(clean(selected?.textContent));
      entry.hasValue = !placeholder;
      entry.options = Array.from(el.options)
        .filter((o) => !o.disabled && !!o.value && !/^(?:[-—]+\s*)?(?:请选择|please\s*(?:select|choose))/i.test(clean(o.textContent)))
        .map((o) => clean(o.textContent))
        .filter(Boolean);
      // 出生年月 / 毕业时间 split into 年 / 月 / 日 dropdowns.
      const numbers = entry.options.map((option) => /^(\d{1,4})\s*[年月日号]?$/.exec(option));
      if (entry.options.length >= 2 && numbers.every(Boolean)) {
        const values = numbers.map((match) => Number(match[1]));
        if (values.every((v) => v >= 1900 && v <= 2100)) entry.datePart = "year";
        else if (values.every((v) => v >= 1 && v <= 12) && values.length <= 13) entry.datePart = "month";
        else if (values.every((v) => v >= 1 && v <= 31) && values.length >= 28) entry.datePart = "day";
      }
    }
    results.push(entry);
  });

  // Dropdowns and text inputs must share DOM order. Per-kind counters were
  // previously mixing rows whenever a dropdown preceded ordinary inputs.
  results.sort((a, b) => (order.get(nodes.get(a.id)) ?? 0) - (order.get(nodes.get(b.id)) ?? 0));
  const groupFor = (field) => {
    const section = field.section || "";
    const text = section || field.label || "";
    return /校园经历|校内经历|在校经历|学生工作|学生干部|社团|校内任职|任职经历|学生会/.test(text) ? "campus" : /获奖|荣誉|奖项|奖励|award|honou?r/i.test(text) ? "award" : /(?<!语言|外语)技能(?!证书)|专业特长|(?:^|\W)skills?(?:\W|$)/i.test(text) && !/语言|外语|language/i.test(text) ? "skill" : /项目|project/i.test(text) ? "project" : /实习|工作经历|工作经验|实践经历|internship|employment|work experience/i.test(text) ? "experience" : /教育|学习经历|本科|硕士|博士|大专|学校|education|academic/i.test(text) ? "education" : /语言(?:能力|成绩|水平|证书|技能|考试)|外语(?:能力|水平|成绩|证书|技能|考试)|英语(?:能力|水平|成绩|考试)(?:情况)?$|^(?:外语|语言)$|language(?:s|\s*skills?|\s*proficiency|\s*tests?)?$/i.test(text) ? "language" : null;
  };
  const isAnchor = (field, group) => {
    const text = field.label || field.placeholder || "";
    return group === "project" ? /^(?:项目)?(?:名称|名)|project[ _-]*(?:name|title)|^name$/i.test(text)
      : group === "experience" ? /公司|单位|企业|机构|company|employer/i.test(text) && !/描述|介绍|职责|行业|性质|规模|类型|地址|城市|电话|部门/.test(text)
      : group === "award" ? /(?:奖项|获奖|荣誉|奖励)名称|^(?:名称|奖项|荣誉|奖励|name)$|^(?:获奖项目?|所获奖项|获得奖项)$|award[ _-]*(?:name|title)/i.test(text)
      : group === "campus" ? (/组织|社团|团体|协会|学生会|^(?:名称|单位)$/.test(text) || /^实践(?:名称|项目|单位)$/.test(text)) && !/职务|级别|描述/.test(text)
      : group === "skill" ? /技能(?:名称|名)|^技能$|^名称$|skill/i.test(text) && !/程度|类别|类型|等级|水平|描述|level|category/i.test(text)
      : group === "language" ? /考试|证书|exam|test|certificat/i.test(text) && !/分数|成绩|时间|日期|score|date/i.test(text)
      : /学校|院校|school|university/i.test(text) && !/城市|性质|排名/.test(text);
  };
  for (const field of results) {
    const group = groupFor(field), el = nodes.get(field.id);
    if (!group || !el) continue;
    let candidate = null;
    // 18: 飞书招聘 puts a date range 13 wrappers below the block that holds its 学校.
    for (let node = parentOf(el), depth = 0; node && node !== document.body && depth < 18; node = parentOf(node), depth++) {
      const children = results.filter((item) => inside(node, nodes.get(item.id)));
      if (children.some((item) => groupFor(item) !== group)) break;
      const members = children;
      const anchors = members.filter((item) => isAnchor(item, group));
      if (anchors.length > 1) break;
      if (anchors.length === 1 && members.length > 1) candidate = node;
    }
    if (candidate) {
      let key = candidate.getAttribute("data-cp-block-key");
      if (!key) { key = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2); if (!readOnly) candidate.setAttribute("data-cp-block-key", key); }
      field.blockKey = group + ":" + key;
    }
  }
  const occurrences = new Map();
  for (const field of results) {
    const el = nodes.get(field.id);
    if (el) {
      const members = radioMembers.get(field.id);
      field.required = !!el.required || el.getAttribute("aria-required") === "true" || !!el.closest(".ant-form-item-required, .is-required") || !!el.closest(".ant-form-item")?.querySelector(".ant-form-item-required");
      field.maxLength = el.maxLength > 0 ? el.maxLength : null;
      field.pattern = el.getAttribute("pattern") || "";
      // 飞书招聘's 起止时间: two plain boxes in one range picker, no 开始 / 结束 placeholders.
      if (el.matches("input") && !/开始|结束|起|止|start|end|from|to/i.test(field.placeholder || "")) {
        const rangeSelector = "[class*='range-picker' i], [class*='date-range' i], [class*='daterange' i]";
        // The nearest wrapper holds one box; the range picker is the first one around two.
        for (let box = el.closest(rangeSelector); box; box = box.parentElement?.closest(rangeSelector)) {
          const boxes = Array.from(box.querySelectorAll("input:not([type='hidden'])"));
          if (boxes.length === 2) { field.rangePart = boxes[0] === el ? "start" : "end"; break; }
          if (boxes.length > 2) break;
        }
      }
      field.min = el.getAttribute("min"); field.max = el.getAttribute("max");
      const checkedAria = field.tag === "radio" && !members ? Array.from(el.querySelectorAll("[role='radio']")).find((choice) => choice.getAttribute("aria-checked") === "true") : null;
      field.currentValue = field.hasValue ? (field.tag === "select" ? clean(el.options[el.selectedIndex]?.textContent)
        : field.tag === "custom-select" ? selectedText(el)
        : field.tag === "richtext" ? clean(el.innerText)
        : field.tag === "radio" ? (members ? optionLabel(members.find((item) => item.checked) || members[0]) : clean(checkedAria?.textContent))
        : String(el.value || "").trim()).slice(0, 20000) : "";
      field.userEdited = members ? members.some((item) => item.getAttribute("data-cp-user-edited") === "1") : el.getAttribute("data-cp-user-edited") === "1" || !!el.querySelector('[data-cp-user-edited="1"]');
      field.portal = portal?.name || "通用表单";
      const key = [field.section, field.label || field.placeholder || field.name, field.tag, field.name].join("|");
      const count = occurrences.get(key) || 0; occurrences.set(key, count + 1);
      field.mappingKey = `${key}|${count}`;
    }
  }
  const captions = new Set(results.flatMap((field) => [field.label, field.placeholder]).map((text) => clean(text).replace(/[*＊：:]/g, "")).filter(Boolean));
  for (const field of results) {
    const el = nodes.get(field.id);
    if (!el) continue;
    const entries = [...new Set(savedEntriesFor(el, captions))].slice(0, 8).map((text) => text.slice(0, 200));
    if (entries.length) field.savedEntries = entries;
  }
  if (!readOnly) for (const field of results) {
    const el = nodes.get(field.id);
    if (el) {
      el.setAttribute("data-cp-fill-label", field.label || field.placeholder || field.name || "字段");
      if (!el.hasAttribute("data-cp-result-key")) el.setAttribute("data-cp-result-key", (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : prefix + Date.now().toString(36) + Math.random().toString(36).slice(2)));
      field.resultKey = el.getAttribute("data-cp-result-key");
    }
  }
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
  clone.querySelectorAll(".ant-select-selection-item, .ud__select__selector__selectItem, .el-select__selected-item, .ant-select-selection-item-content, .el-tag, .ant-upload-list").forEach((el) => { el.textContent = "[已选内容]"; });
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
  for (const row of [...(profile.education || []), ...(profile.experiences || []), ...(profile.projects || []), ...(profile.awards || [])]) {
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
  const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
  inputs.forEach((el) => el.removeAttribute("data-cp-resume-upload"));
  let marked = 0;
  for (const el of inputs) {
    if (el.disabled || el.files?.length) continue;
    const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const nearby = el.closest("label, .form-item, .ant-form-item, .el-form-item, [class*='upload']");
    const uploadArea = el.closest(".ant-form-item, .el-form-item") || nearby;
    if (uploadArea?.querySelector(".ant-upload-list-item-done, .el-upload-list__item.is-success")) continue;
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
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Fields inside open shadow roots carry the same data-cp-fill-id markers.
  const roots = [document];
  for (let i = 0; i < roots.length; i++) Array.from(roots[i].querySelectorAll ? roots[i].querySelectorAll("*") : []).forEach((node) => { if (node.shadowRoot) roots.push(node.shadowRoot); });
  const find = (selector) => { for (const root of roots) { const hit = root.querySelector(selector); if (hit) return hit; } return null; };
  const findAll = (selector) => roots.flatMap((root) => Array.from(root.querySelectorAll ? root.querySelectorAll(selector) : []));
  const clean = (text) => String(text || "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").replace(/([㐀-鿿]) (?=[㐀-鿿])/g, "$1").trim();
  // Same reading as scanPageFields, so a matched option text compares equal.
  function optionLabel(radio) {
    const wrap = radio.closest("label");
    if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
    const byFor = radio.id ? radio.getRootNode().querySelector('label[for="' + CSS.escape(radio.id) + '"]') : null;
    if (byFor && clean(byFor.textContent)) return clean(byFor.textContent);
    for (let node = radio.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === 1 && (node.matches("input, select, textarea") || node.querySelector("input, select, textarea"))) break;
      const text = clean(node.textContent);
      if (text) return text;
    }
    return clean(radio.value);
  }

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
  function confirmManual(el, p) {
    if (!p.manualConfirmed) return;
    el.setAttribute("data-cp-user-edited", "1");
    el.setAttribute("data-cp-user-edited-at", String(Date.now()));
    el.setAttribute("data-cp-memory-pending", "1");
  }

  // Component-library date pickers keep the typed text only once they
  // commit it: Enter plus a real blur (React listens for focusout, which a
  // synthetic "blur" event never produces). Their inputs may be read-only
  // (no free typing), yet still parse a value set through these events.
  const PICKER = ".ant-picker, .el-date-editor, .el-range-editor, .arco-picker, .ivu-date-picker, .t-date-picker, [class*='date-picker'], [class*='datepicker']";
  const LIBRARY_PICKER = ".ant-picker, .el-date-editor, .el-range-editor, .arco-picker, .ivu-date-picker, .t-date-picker";
  const UNTIL_NOW_TEXT = /至今|目前|在读|在职|present|current|till now|to date/i;
  const pickerDone = new Set();

  // "至今" on an end date is almost always a checkbox/switch beside it, not
  // text the picker would accept. Nearest wrapper first, so a second block's
  // end date never ticks the first block's box.
  async function tickUntilNow(el, source) {
    let scope = el.parentElement;
    for (let depth = 0; scope && depth < 5; depth++, scope = scope.parentElement) {
      const toggles = Array.from(scope.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]'));
      const toggle = toggles.find((node) => UNTIL_NOW_TEXT.test(((node.closest("label") || node.parentElement || node).textContent || "") + " " + (node.getAttribute("aria-label") || "")));
      if (!toggle) continue;
      const isOn = () => toggle.checked === true || toggle.getAttribute("aria-checked") === "true";
      if (!isOn()) { (toggle.closest("label") || toggle).click(); await sleep(50); }
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
      const radios = findAll('[data-cp-fill-id^="' + p.id + ':"]');
      if (radios.some((r) => r.checked || r.getAttribute("data-cp-user-edited") === "1")) {
        skipped.push(p.id);
        continue;
      }
      const target = radios.find((r) => optionLabel(r) === p.value);
      if (!target || target.disabled) { failed.push(p.label || p.id); continue; }
      // Styled pills hide the input; clicking its label is what a person does.
      const label = target.closest("label");
      // Vue-based radios (Element Plus) reset `checked` and set it again on
      // their next render, so the result is read a tick later.
      target.click();
      await sleep(50);
      if (!target.checked && label) { label.click(); await sleep(50); }
      if (!target.checked) { failed.push(p.label || p.id); continue; }
      mark(label || target, p.source || "profile", p.answerId);
      if (p.answerId) target.setAttribute("data-cp-answer-id", p.answerId);
      if ((p.source || "profile") === "profile") target.setAttribute("data-cp-profile-filled", "1");
      confirmManual(target, p);
      filled.push(p.id);
      continue;
    }
    if (/-g\d+$/.test(p.id)) {
      // ARIA radio group: role=radio options, chosen state in aria-checked.
      const group = find('[data-cp-fill-id="' + p.id + '"]');
      if (!group) { failed.push(p.label || p.id); continue; }
      const choices = Array.from(group.querySelectorAll("[role='radio']"));
      const isOn = (choice) => choice.getAttribute("aria-checked") === "true";
      if (choices.some(isOn) || group.getAttribute("data-cp-user-edited") === "1") { skipped.push(p.id); continue; }
      const target = choices.find((choice) => clean(choice.textContent) === p.value);
      if (!target || target.getAttribute("aria-disabled") === "true") { failed.push(p.label || p.id); continue; }
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      target.click();
      await sleep(60);
      if (!isOn(target)) { failed.push(p.label || p.id); continue; }
      mark(group, p.source || "profile", p.answerId);
      confirmManual(group, p);
      filled.push(p.id);
      continue;
    }
    const el = find('[data-cp-fill-id="' + p.id + '"]');
    const rich = !!el && el.isContentEditable && !/^(?:INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    if (!el || (p.tag && (rich ? p.tag !== "richtext" : el.tagName.toLowerCase() !== p.tag)) || el.disabled || (el.readOnly && !(el.tagName === "INPUT" && el.closest(LIBRARY_PICKER)))) {
      failed.push(p.label || p.id);
      continue;
    }
    const selected = el.tagName.toLowerCase() === "select" ? el.options[el.selectedIndex] : null;
    const placeholder = selected && (!selected.value || /^(?:请(?:选择|选取)|please\s*(?:select|choose)|select\s*(?:one|an?\b)|choose\s*(?:one|an?\b)|[-—]+\s*(?:请选择|select))/i.test(clean(selected.textContent)));
    const current = rich ? clean(el.innerText) : el.value && String(el.value).trim();
    if ((!placeholder && current) || el.getAttribute("data-cp-user-edited") === "1") {
      skipped.push(p.id);
      continue;
    }
    if (rich) {
      // execCommand goes through the editor's own input handling (Quill,
      // wangEditor, CKEditor); plain text is the fallback for simple boxes.
      const flat = (text) => String(text || "").replace(/\s+/g, "");
      el.setAttribute("data-cp-filling", "1");
      try {
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        let inserted = false;
        try { inserted = document.execCommand("insertText", false, p.value); } catch { inserted = false; }
        if (!inserted || !flat(el.innerText).includes(flat(p.value).slice(0, 40))) {
          el.textContent = p.value;
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: p.value }));
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
        el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        await sleep(60);
      } finally {
        el.removeAttribute("data-cp-filling");
      }
      if (!flat(el.innerText).includes(flat(p.value).slice(0, 40))) { failed.push(p.label || p.id); continue; }
      mark(el, p.source || "profile", p.answerId);
      confirmManual(el, p);
      filled.push(p.id);
      continue;
    }
    const tag = el.tagName.toLowerCase();
    const picker = tag === "input" ? el.closest(PICKER) : null;
    if (p.value === "至今" && (picker || el.type === "date" || el.type === "month")) {
      if (await tickUntilNow(el, p.source || "profile")) filled.push(p.id);
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
        return pair && !input.disabled && (!input.readOnly || input.closest(LIBRARY_PICKER)) ? { input, pair } : null;
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
        await sleep(80);
      }
      if (!group.length) continue;
      const last = group[group.length - 1].input;
      last.blur();
      last.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      await sleep(150);
      for (const { input, pair } of group) {
        if (input.value !== pair.value) { failed.push(pair.label || pair.id); continue; }
        mark(picker, pair.source || "profile", pair.answerId);
        // Memory reads the input itself, not the outlined wrapper.
        if ((pair.source || "profile") === "profile") input.setAttribute("data-cp-profile-filled", "1");
        if (pair.answerId) input.setAttribute("data-cp-answer-id", pair.answerId);
        confirmManual(input, pair);
        filled.push(pair.id);
      }
      continue;
    }
    // A number box takes "3.8" from "3.8/4.0"; a date box only ISO.
    const write = el.type === "number" ? (String(p.value).match(/-?\d+(?:\.\d+)?/) || [""])[0]
      : el.type === "date" || el.type === "month" ? normalizeDate(p.value, el.type) : p.value;
    if (!write) { failed.push(p.label || p.id); continue; }
    if (tag === "select") {
      const match = Array.from(el.options).find((o) => !o.disabled && clean(o.textContent) === p.value);
      if (!match) { failed.push(p.label || p.id); continue; }
      el.value = match.value;
    } else if (tag === "textarea") {
      nativeTextareaSetter.call(el, write);
    } else {
      nativeInputSetter.call(el, write);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    // Controlled components can revert after input/change handlers run.
    await sleep(50);
    const actual = tag === "select" ? clean(el.options[el.selectedIndex]?.textContent) : el.value;
    const expected = tag === "select" ? p.value : write;
    if (actual !== expected) { failed.push(p.label || p.id); continue; }
    mark(el, p.source || "profile", p.answerId);
    confirmManual(el, p);
    filled.push(p.id);
  }
  return { filled, failed, skipped };
}

// Opens each custom dropdown, reads whatever options it renders, clicks the
// best match for the wanted value, and closes it again if nothing fits.
// Async because these libraries render the option list on the next tick.
async function fillCustomSelects(pairs, taskId) {
  const assertActive = () => {
    if (taskId && document.documentElement.getAttribute("data-cp-task") !== taskId) throw new Error("填写已停止");
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const filled = [];
  const failed = [];
  const skipped = [];
  const roots = [document];
  for (let i = 0; i < roots.length; i++) Array.from(roots[i].querySelectorAll ? roots[i].querySelectorAll("*") : []).forEach((node) => { if (node.shadowRoot) roots.push(node.shadowRoot); });
  const find = (selector) => { for (const root of roots) { const hit = root.querySelector(selector); if (hit) return hit; } return null; };
  const clean = (text) => String(text || "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").replace(/([㐀-鿿]) (?=[㐀-鿿])/g, "$1").trim();
  // Same reading as scanPageFields: what the dropdown currently shows.
  const PLACEHOLDER_TEXT = /^(?:请|点击|點擊)?(?:选择|选取|输入|填写|搜索)|^(?:select|choose|search|please (?:select|choose|enter))\b|^(?:--|—)/i;
  function ownText(node) {
    if (typeof node.cloneNode !== "function") return "";
    const copy = node.cloneNode(true);
    copy.querySelectorAll("[role='listbox'], [role='option'], [hidden], [aria-hidden='true'], ul, ol, svg, i, style, [class*='placeholder']:not(.el-select__placeholder), .el-select__placeholder.is-transparent").forEach((child) => child.remove());
    return clean(copy.textContent);
  }
  function selectedText(container) {
    const shown = container.querySelector(".ant-select-selection-item, .ud__select__selector__selectItem, .el-select__selected-item:not(.el-select__placeholder):not(.el-select__input-wrapper), .el-select__placeholder:not(.is-transparent), .el-select__tags-text, .el-cascader__tags");
    // Some portals print their prompt ("输入工作单位名称") where the choice goes.
    if (shown && clean(shown.textContent) && !PLACEHOLDER_TEXT.test(clean(shown.textContent))) return clean(shown.textContent);
    // Element UI and cascaders show the choice in a read-only input; Arco,
    // Semi or Fusion keep the input for searching and show it as text.
    const input = container.matches("input") ? container : container.querySelector("input:not([type='hidden'])");
    if (input && clean(input.value) && !PLACEHOLDER_TEXT.test(clean(input.value))) return clean(input.value);
    if (container.matches("input")) return "";
    const text = ownText(container);
    return !/[\p{L}\p{N}]/u.test(text) || PLACEHOLDER_TEXT.test(text) || text === clean(container.getAttribute("placeholder")) || text === clean(input?.getAttribute("placeholder")) ? "" : text;
  }
  function hasExistingValue(container) {
    return !!selectedText(container) || container.getAttribute("data-cp-user-edited") === "1" || !!container.querySelector('[data-cp-user-edited="1"]');
  }
  function visible(n) {
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function visibleOptions(container) {
    // An ARIA combobox names its own list; that one wins when it is showing.
    const owned = container && !container.matches(".ant-select, .el-select") ? (container.getAttribute("aria-controls") || container.getAttribute("aria-owns") || container.querySelector("[aria-controls]")?.getAttribute("aria-controls")) : null;
    const list = owned ? document.getElementById(owned) : null;
    if (list && visible(list)) {
      const own = Array.from(list.querySelectorAll("[role='option']:not([aria-disabled='true'])")).filter(visible);
      if (own.length) return own;
    }
    const nodes = document.querySelectorAll(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:not(.ant-select-item-option-disabled), " +
        ".el-select-dropdown:not([style*='display: none']) .el-select-dropdown__item:not(.is-disabled), " +
        ".ivu-select-dropdown .ivu-select-item:not(.ivu-select-item-disabled), .arco-select-option:not(.arco-select-option-disabled), .t-select-option:not(.t-is-disabled), " +
        "[role='listbox'] [role='option']:not([aria-disabled='true']), " +
        ".ud__select__dropdown:not([class*='dropdown-hidden']) .ud__select__list__item:not([class*='item-disabled'])"
    );
    return Array.from(nodes).filter(visible);
  }
  function optionText(n) {
    const inner = n.querySelector(".ant-select-item-option-content");
    return clean((inner || n).textContent);
  }
  function pickOne(options, value) {
    const v = clean(value);
    const exact = options.find((o) => optionText(o) === v);
    if (exact) return exact;
    const fuzzy = options.filter((o) => optionText(o).includes(v) || (v.includes(optionText(o)) && optionText(o).length >= 2));
    return fuzzy.length === 1 ? fuzzy[0] : null;
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
  function open(container) {
    // Innermost first: a click on the inner input bubbles up through the
    // wrapper/selector, so every library's own handler sees it.
    const trigger = container.querySelector("input:not([type='hidden'])") || container.querySelector(".ant-select-selector, .el-select__wrapper, .el-input__wrapper") || container;
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    trigger.click();
  }
  function close() {
    for (const target of [document.activeElement || document.body, document.body]) target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.body.click();
  }
  // Option lists can load from the network a moment after opening.
  async function waitFor(read, ms) {
    for (let waited = 0; ; waited += 150) {
      const found = read();
      if (found.length || waited >= ms) return found;
      await sleep(150);
      assertActive();
    }
  }

  // 省 → 市 (→ 区) cascaders: walk the columns, matching each level against
  // what's left of the wanted text ("江苏南京" → 江苏省 → 南京市). A value
  // without its province ("深圳") is found by looking one level down.
  async function fillCascader(container, value) {
    const ant = !container.classList.contains("el-cascader");
    const columns = () => Array.from(document.querySelectorAll(ant ? ".ant-cascader-dropdown:not(.ant-select-dropdown-hidden) .ant-cascader-menu" : ".el-cascader__dropdown .el-cascader-menu")).filter(visible);
    const items = (column) => Array.from(column.querySelectorAll(ant ? ".ant-cascader-menu-item" : ".el-cascader-node")).filter((item) => visible(item) && !/disabled/.test(item.className));
    const text = (item) => clean((item.querySelector(".ant-cascader-menu-item-content, .el-cascader-node__label") || item).textContent);
    const SUFFIX = /(?:特别行政区|维吾尔自治区|壮族自治区|回族自治区|自治区|自治州|地区|省|市|盟|区|县)$/;
    const base = (t) => t.replace(SUFFIX, "") || t;
    const isLeaf = (item) => ant ? !item.querySelector(".ant-cascader-menu-item-expand-icon") : item.getAttribute("aria-haspopup") !== "true";
    const matches = (item, rest) => { const t = text(item), b = base(t); return rest.startsWith(t) || (b.length >= 2 && rest.includes(b)); };
    open(container);
    await sleep(250);
    assertActive();
    if (!(await waitFor(columns, 1000)).length) return false;
    let rest = clean(value).replace(/[\s/,，、|>\-]+/g, "");
    let previous = "";
    for (let level = 0; level < 5; level++) {
      const column = columns()[level];
      if (!column) return false;
      const list = items(column);
      let target = list.find((item) => matches(item, rest));
      let expanded = false;
      // 上海 → 上海市 → 浦东新区: a municipality repeats itself one level down.
      if (!target && level > 0) target = list.length === 1 ? list[0] : list.find((item) => base(text(item)) === base(previous));
      if (!target && level === 0) {
        for (const item of list.slice(0, 40)) {
          item.click();
          await sleep(180);
          assertActive();
          const next = columns()[1];
          if (next && items(next).some((child) => matches(child, rest))) { target = item; expanded = true; break; }
        }
      }
      if (!target) return false;
      if (!expanded) {
        target.click();
        await sleep(250);
        assertActive();
      }
      const label = text(target);
      const at = rest.startsWith(label) ? label.length : rest.indexOf(base(label)) >= 0 ? rest.indexOf(base(label)) + base(label).length : 0;
      rest = rest.slice(at).replace(/^(?:特别行政区|自治区|省|市|区|县)/, "");
      previous = label;
      if (isLeaf(target)) return true;
    }
    return false;
  }

  for (const p of pairs) {
    assertActive();
    const container = find('[data-cp-fill-id="' + p.id + '"]');
    if (!container || !p.value) continue;
    if (container.classList.contains("ant-select-disabled") || container.classList.contains("is-disabled") || container.getAttribute("aria-disabled") === "true" || container.disabled) {
      failed.push(p.label || p.id);
      continue;
    }
    if (hasExistingValue(container)) { skipped.push(p.id); continue; }
    if (container.classList.contains("ant-cascader") || container.classList.contains("el-cascader")) {
      let ok = false;
      try { ok = await fillCascader(container, p.value); } catch (error) { if (/填写已停止/.test(error.message)) throw error; }
      await sleep(150);
      assertActive();
      if (ok && selectedText(container)) {
        mark(container, p.source || "profile");
        if ((p.source || "profile") === "profile") container.setAttribute("data-cp-profile-filled", "1");
        filled.push(p.id);
      } else {
        close();
        failed.push(p.label || p.id);
      }
      continue;
    }
    open(container);
    await sleep(300);
    assertActive();
    let options = await waitFor(() => visibleOptions(container), 600);
    if (hasExistingValue(container)) { close(); skipped.push(p.id); continue; }
    let target = pick(options, p);
    // Searchable selects (and virtual lists that only render a screenful):
    // type the value to narrow the list, then look again.
    const searchInput = container.querySelector("input:not([readonly]):not([type='hidden'])");
    if (!target && searchInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(searchInput, String(p.value));
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(450);
      assertActive();
      options = await waitFor(() => visibleOptions(container), 600);
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
      assertActive();
      const visibleValue = selectedText(container);
      if (visibleValue && (visibleValue === wanted || visibleValue.includes(wanted) || visibleValue.includes(clean(p.value)))) {
        mark(container, p.source || "profile");
        if (p.answerId) container.setAttribute("data-cp-answer-id", p.answerId);
        if ((p.source || "profile") === "profile") container.setAttribute("data-cp-profile-filled", "1");
        if (p.manualConfirmed) { container.setAttribute("data-cp-user-edited", "1"); container.setAttribute("data-cp-user-edited-at", String(Date.now())); container.setAttribute("data-cp-memory-pending", "1"); }
        filled.push(p.id);
      } else {
        close();
        failed.push(p.label || p.id);
      }
    } else {
      failed.push(p.label || p.id);
      close();
      await sleep(100);
      assertActive();
    }
  }
  return { filled, failed, skipped };
}

// Side-effect-free count of what an autofill could touch right now — used
// by the multi-step form watcher to notice "a new form page just appeared".
function countFillableFields(scan = scanPageFields) {
  const fields = scan("readonly-", true).filter((field) => !field.hasValue);
  const labels = fields.slice(0, 6).map((field) => (field.name || field.placeholder || field.label || "").slice(0, 20));
  return { count: fields.length, signature: location.href + "|" + fields.length + "|" + labels.join(",") };
}

function clearFillMarks() {
  const roots = [document];
  for (let i = 0; i < roots.length; i++) Array.from(roots[i].querySelectorAll ? roots[i].querySelectorAll("*") : []).forEach((node) => { if (node.shadowRoot) roots.push(node.shadowRoot); });
  roots.forEach((root) => root.querySelectorAll("[data-cp-filled]").forEach((el) => {
    el.style.removeProperty("outline");
    el.style.removeProperty("outline-offset");
    el.removeAttribute("data-cp-filled");
  }));
}

// Installed inside each guest frame. Only real user input marks a field for
// automatic memory; our own fillFields dispatches synthetic events and never
// confirms an AI draft by accident. composedPath() reaches inputs inside
// open shadow roots, whose events are otherwise retargeted to the host.
function trackUserEdits() {
  if (document.__cpUserEditTrackerInstalled) return;
  document.__cpUserEditTrackerInstalled = true;
  const stamp = (el) => {
    el.setAttribute("data-cp-user-edited", "1");
    el.setAttribute("data-cp-user-edited-at", String(Date.now()));
    el.setAttribute("data-cp-memory-pending", "1");
  };
  const origin = (event) => (event.composedPath ? event.composedPath()[0] : event.target);
  const mark = (event) => {
    if (!event.isTrusted) return;
    const el = origin(event);
    if (!el || !el.matches) return;
    // Rich-text editors: the editable root carries the field id. Text our
    // own fill inserts through execCommand is trusted too, hence the flag.
    const editable = el.closest?.("[contenteditable='true'], [contenteditable='']");
    if (editable && !el.matches("input, textarea, select")) {
      if (!editable.hasAttribute("data-cp-filling")) stamp(editable);
      return;
    }
    if (!el.matches('textarea, select, input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="date"], input[type="month"], input[type="url"], input[type="radio"], input[type="search"], input:not([type])')) return;
    if (el.disabled || el.readOnly) return;
    stamp(el);
  };
  document.addEventListener("input", mark, true);
  document.addEventListener("change", mark, true);
  let selected = null;
  const shownValue = (el) => (el.querySelector(".ant-select-selection-item, .ud__select__selector__selectItem, .el-select__selected-item:not(.el-select__placeholder):not(.el-select__input-wrapper), .el-select__placeholder:not(.is-transparent)")?.textContent || el.value || (el.matches("button, [role='combobox']") ? el.textContent : "") || "").trim();
  document.addEventListener("pointerdown", (event) => {
    if (!event.isTrusted) return;
    const el = origin(event)?.closest?.(".ant-select, .el-select, .el-cascader, .ud__select__selector, [role='combobox'], button[aria-haspopup='listbox']");
    if (el) selected = { el, at: Date.now(), value: shownValue(el) };
  }, true);
  document.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    // ARIA radio groups have no input events; a click on an option is the edit.
    const choice = origin(event)?.closest?.("[role='radio']");
    const group = choice?.closest("[role='radiogroup']");
    if (group) setTimeout(() => { if (choice.getAttribute("aria-checked") === "true") stamp(group); }, 100);
    if (!selected || Date.now() - selected.at > 30000) return;
    const candidate = selected;
    setTimeout(() => {
      if (shownValue(candidate.el) !== candidate.value) {
        stamp(candidate.el);
        selected = null;
      }
    }, 150);
  }, true);
}

function hasUserEditedFields() {
  const roots = [document];
  for (let i = 0; i < roots.length; i++) Array.from(roots[i].querySelectorAll ? roots[i].querySelectorAll("*") : []).forEach((node) => { if (node.shadowRoot) roots.push(node.shadowRoot); });
  return roots.some((root) => !!root.querySelector('[data-cp-memory-pending="1"], [data-cp-user-edited="1"]:not([data-cp-memory-saved])'));
}

// Read side of fillFields — same element lookup and same "select reads by
// visible option text" rule, so a value read back here compares cleanly
// against what fillFields originally wrote.
function readFieldValues(ids) {
  const result = {};
  const roots = [document];
  for (let i = 0; i < roots.length; i++) Array.from(roots[i].querySelectorAll ? roots[i].querySelectorAll("*") : []).forEach((node) => { if (node.shadowRoot) roots.push(node.shadowRoot); });
  const find = (selector) => { for (const root of roots) { const hit = root.querySelector(selector); if (hit) return hit; } return null; };
  const findAll = (selector) => roots.flatMap((root) => Array.from(root.querySelectorAll ? root.querySelectorAll(selector) : []));
  const clean = (text) => String(text || "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").replace(/([㐀-鿿]) (?=[㐀-鿿])/g, "$1").trim();
  function optionLabel(radio) {
    const wrap = radio.closest("label");
    if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
    const byFor = radio.id ? radio.getRootNode().querySelector('label[for="' + CSS.escape(radio.id) + '"]') : null;
    if (byFor && clean(byFor.textContent)) return clean(byFor.textContent);
    for (let node = radio.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === 1 && (node.matches("input, select, textarea") || node.querySelector("input, select, textarea"))) break;
      const text = clean(node.textContent);
      if (text) return text;
    }
    return clean(radio.value);
  }
  const PLACEHOLDER_TEXT = /^(?:请|点击|點擊)?(?:选择|选取|输入|填写|搜索)|^(?:select|choose|search|please (?:select|choose|enter))\b|^(?:--|—)/i;
  function fieldValue(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") return clean(el.options[el.selectedIndex]?.textContent);
    if (el.getAttribute("role") === "radiogroup") return clean(el.querySelector("[role='radio'][aria-checked='true']")?.textContent);
    if (el.isContentEditable && tag !== "input" && tag !== "textarea") return String(el.innerText || "").trim();
    if (tag === "input" || tag === "textarea") return String(el.value || "").trim();
    const shown = el.querySelector(".ant-select-selection-item, .ud__select__selector__selectItem, .el-select__selected-item:not(.el-select__placeholder):not(.el-select__input-wrapper), .el-select__placeholder:not(.is-transparent), .el-select__tags-text");
    if (shown && clean(shown.textContent) && !PLACEHOLDER_TEXT.test(clean(shown.textContent))) return clean(shown.textContent);
    const input = el.querySelector("input:not([type='hidden'])");
    if (input && clean(input.value) && !PLACEHOLDER_TEXT.test(clean(input.value))) return clean(input.value);
    const copy = el.cloneNode(true);
    copy.querySelectorAll("[role='listbox'], [role='option'], [hidden], [aria-hidden='true'], ul, ol, svg, i, style, [class*='placeholder']:not(.el-select__placeholder), .el-select__placeholder.is-transparent").forEach((child) => child.remove());
    const text = clean(copy.textContent);
    return !/[\p{L}\p{N}]/u.test(text) || PLACEHOLDER_TEXT.test(text) || text === clean(input?.getAttribute("placeholder")) ? "" : text;
  }
  const active = (() => { let el = document.activeElement; while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement; return el; })();
  ids.forEach((id) => {
    const radio = findAll('[data-cp-fill-id^="' + id + ':"]');
    if (radio.length) {
      const selected = radio.find((el) => el.checked);
      result[id] = { value: selected ? optionLabel(selected) : "", answerId: selected?.getAttribute("data-cp-answer-id"), profileFilled: radio.some((el) => el.getAttribute("data-cp-profile-filled") === "1"), userEdited: radio.some((el) => el.getAttribute("data-cp-user-edited") === "1"), editedAt: Math.max(...radio.map((el) => Number(el.getAttribute("data-cp-user-edited-at")) || 0)), memorySaved: radio[0].getAttribute("data-cp-memory-saved") };
      return;
    }
    const el = find('[data-cp-fill-id="' + id + '"]');
    if (!el) return;
    const value = fieldValue(el);
    const block = el.closest("[data-cp-block-key]");
    const editing = active?.matches?.('input:not([type="button"]):not([type="submit"]), textarea, select, [role="combobox"], [contenteditable="true"], [contenteditable=""]') && document.hasFocus();
    result[id] = { value, answerId: el.getAttribute("data-cp-answer-id"), profileFilled: el.getAttribute("data-cp-profile-filled") === "1", userEdited: el.getAttribute("data-cp-user-edited") === "1", editedAt: Number(el.getAttribute("data-cp-user-edited-at")) || 0, memorySaved: el.getAttribute("data-cp-memory-saved"), active: !!editing && (el === active || el.contains(active) || !!block?.contains(active)) };
  });
  return result;
}

function clearSavedUserEdits(saved) {
  const roots = [document];
  for (let i = 0; i < roots.length; i++) Array.from(roots[i].querySelectorAll ? roots[i].querySelectorAll("*") : []).forEach((node) => { if (node.shadowRoot) roots.push(node.shadowRoot); });
  const find = (selector) => { for (const root of roots) { const hit = root.querySelector(selector); if (hit) return hit; } return null; };
  const findAll = (selector) => roots.flatMap((root) => Array.from(root.querySelectorAll ? root.querySelectorAll(selector) : []));
  const clean = (text) => String(text || "").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").replace(/([㐀-鿿]) (?=[㐀-鿿])/g, "$1").trim();
  function optionLabel(radio) {
    const wrap = radio.closest("label");
    if (wrap && clean(wrap.textContent)) return clean(wrap.textContent);
    const byFor = radio.id ? radio.getRootNode().querySelector('label[for="' + CSS.escape(radio.id) + '"]') : null;
    if (byFor && clean(byFor.textContent)) return clean(byFor.textContent);
    for (let node = radio.nextSibling; node; node = node.nextSibling) {
      if (node.nodeType === 1 && (node.matches("input, select, textarea") || node.querySelector("input, select, textarea"))) break;
      const text = clean(node.textContent);
      if (text) return text;
    }
    return clean(radio.value);
  }
  const PLACEHOLDER_TEXT = /^(?:请|点击|點擊)?(?:选择|选取|输入|填写|搜索)|^(?:select|choose|search|please (?:select|choose|enter))\b|^(?:--|—)/i;
  function fieldValue(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") return clean(el.options[el.selectedIndex]?.textContent);
    if (el.getAttribute("role") === "radiogroup") return clean(el.querySelector("[role='radio'][aria-checked='true']")?.textContent);
    if (el.isContentEditable && tag !== "input" && tag !== "textarea") return String(el.innerText || "").trim();
    if (tag === "input" || tag === "textarea") return String(el.value || "").trim();
    const shown = el.querySelector(".ant-select-selection-item, .ud__select__selector__selectItem, .el-select__selected-item:not(.el-select__placeholder):not(.el-select__input-wrapper), .el-select__placeholder:not(.is-transparent), .el-select__tags-text");
    if (shown && clean(shown.textContent) && !PLACEHOLDER_TEXT.test(clean(shown.textContent))) return clean(shown.textContent);
    const input = el.querySelector("input:not([type='hidden'])");
    if (input && clean(input.value) && !PLACEHOLDER_TEXT.test(clean(input.value))) return clean(input.value);
    const copy = el.cloneNode(true);
    copy.querySelectorAll("[role='listbox'], [role='option'], [hidden], [aria-hidden='true'], ul, ol, svg, i, style, [class*='placeholder']:not(.el-select__placeholder), .el-select__placeholder.is-transparent").forEach((child) => child.remove());
    const text = clean(copy.textContent);
    return !/[\p{L}\p{N}]/u.test(text) || PLACEHOLDER_TEXT.test(text) || text === clean(input?.getAttribute("placeholder")) ? "" : text;
  }
  for (const item of saved) {
    const radios = findAll('[data-cp-fill-id^="' + item.id + ':"]');
    if (radios.length) {
      const selected = radios.find((el) => el.checked);
      const value = selected ? optionLabel(selected) : "";
      if (value === item.value) radios.forEach((el) => { el.setAttribute("data-cp-memory-saved", value); el.removeAttribute("data-cp-memory-pending"); });
      continue;
    }
    const el = find('[data-cp-fill-id="' + item.id + '"]');
    if (!el) continue;
    const value = fieldValue(el);
    if (value === item.value) {
      el.setAttribute("data-cp-memory-saved", item.value);
      el.removeAttribute("data-cp-memory-pending");
    }
  }
}

function memoryCandidate(snapshot, filledList, onlyUserEdited = false) {
  if (onlyUserEdited && (!snapshot.userEdited || snapshot.active || !snapshot.editedAt || Date.now() - snapshot.editedAt < 2500)) return null;
  if (snapshot.profileFilled && !snapshot.userEdited) return null;
  const value = String(snapshot.value || "").trim();
  if (!value) return null;
  if (onlyUserEdited && snapshot.memorySaved === value) return null;
  const draft = filledList.findLast((entry) => entry.answerId === snapshot.answerId);
  if (draft && draft.filledValue === value) return null;
  return { value, answerId: draft?.answerId };
}

// Runs in the main process, not injected — matches detected form fields to
// the user's own saved profile by keyword. Intentionally conservative: a
// field with no confident match is left for the AI pass (or manual entry)
// rather than guessed at here. English keys match whole words only ("tel"
// is not in "Tell us…"), and `not` rules out look-alikes: 姓名拼音, English
// Name, Mailing Address, Place of Birth, a landline next to the mobile.
const BASIC_FIELD_RULES = [
  { keys: ["姓名", "真实姓名", "name"], not: /拼音|英文|外文|曾用名|别名|昵称|用户名|账号|登录|签名|pinyin|english|romani[sz]|alias|nick|preferred|user ?name|login|account|school|university|college|company|employer|organi[sz]ation|project|award|course|program|position|job|file/i, get: (p) => p.name },
  { keys: ["手机", "电话", "联系电话", "联系方式", "phone", "mobile", "tel", "telephone", "cell"], not: /固定电话|座机|固话|家庭电话|办公电话|单位电话|传真|区号|分机|国家|地区代码|类型|landline|home phone|work phone|office phone|fax|area code|country|dialing|extension|device|type/i, get: (p) => p.phone, phone: true },
  { keys: ["邮箱", "电子邮件", "邮件地址", "email", "e-mail"], not: /mailing|postal|邮编|邮政/i, get: (p) => p.email },
  // A free 英文名 box (Eason / Yihong Chen) — not a first / last name split, which stays manual.
  { keys: ["英文名", "英文姓名", "英文名字", "english name"], not: /拼音|姓氏|first|last|given|family|surname/i, get: (p) => p.englishName, learn: "englishName" },
  { keys: ["性别", "gender", "sex"], get: (p) => p.gender },
  // exactDay: a birthday is never padded to the 1st the way 入学时间 is.
  // 年龄 is the birth date, counted to today (飞书招聘 asks for it as a required number).
  { keys: ["年龄", "周岁"], not: /是否|要求|范围|以上|以下|不超过|不低于|家庭|配偶|子女|父|母|紧急|推荐人|age range/i, get: (p) => ageFromBirthDate(p.birthDate) },
  { keys: ["出生日期", "出生年月", "生日", "birth", "birthday", "birthdate"], not: /地点|出生地|place|city|country|province|省份|籍贯/i, get: (p) => p.birthDate, date: true, exactDay: true },
  // School/major/degree/GPA/dates are per education row — see
  // resolveRepeatField below. Only the page-wide "最高学历" stays flat.
  { keys: ["最高学历", "highest degree", "highest education"], get: (p) => highestEducation(p)?.degree, degree: true },
  // `learn`: the 网申资料 field a hand-typed answer here fills while it is blank.
  { keys: ["英语", "外语", "cet", "english", "语言能力"], not: /姓名|名字|name/i, get: (p) => p.english, english: true, learn: "english" },
  { keys: ["政治面貌", "politic", "political", "politics"], get: (p) => p.politics, learn: "politics" },
  { keys: ["籍贯", "户籍", "户口所在地", "hometown"], not: /地址|详细|街道|门牌/, get: (p) => p.hometown, learn: "hometown" },
  { keys: ["民族", "ethnic", "ethnicity"], get: (p) => p.ethnicity, learn: "ethnicity" },
  { keys: ["微信", "wechat", "weixin"], get: (p) => p.wechat, learn: "wechat" },
  { keys: ["qq", "qq号", "qq号码"], get: (p) => p.qq, learn: "qq" },
  { keys: ["期望薪资", "期望月薪", "期望年薪", "期望薪酬", "期望待遇", "薪资要求", "薪资期望", "expected salary", "salary expectation"], get: (p) => p.expectedSalary, learn: "expectedSalary" },
  { keys: ["到岗时间", "到岗日期", "可入职", "最早入职", "available from", "availability date", "earliest start"], get: (p) => p.availableFrom, date: true, learn: "availableFrom" },
  { keys: ["实习时长", "实习周期", "可实习时长", "可实习时间", "每周实习", "每周可实习", "实习天数", "internship duration"], get: (p) => p.internshipDuration, learn: "internshipDuration" },
  { keys: ["通讯地址", "联系地址", "家庭住址", "现住址", "居住地址", "详细地址", "邮寄地址", "mailing address", "home address", "street address", "address line"], not: /e-?mail|邮箱|户口|户籍|原籍/i, get: (p) => p.address, learn: "address" },
  // Preferred cities first: a bare English "City" (address blocks) is where
  // the applicant lives, not where they'd like to work.
  { keys: ["意向城市", "期望城市", "工作城市", "意向工作地", "期望工作地", "工作地点", "意向地点", "期望地点", "工作地区", "preferred city", "preferred location", "desired location", "work location"], not: /是否|可否|能否|接受/, get: (p) => p.preferredCities },
  // English portals (Microsoft, Workday …): country of residence, before the bare "city" rule.
  { keys: ["country/region", "country / region", "country or region", "country of residence", "country", "所在国家", "居住国家", "国家/地区", "国家或地区"], not: /code|区号|代码|phone|dial|birth|出生|citizenship|nationality|国籍|issu|签发|city|城市|state of/i, get: (p) => p.country || countryFromCity(p.currentCity), learn: "country", english: false, englishName: true },
  { keys: ["现居", "现住", "所在城市", "常住", "居住城市", "current city", "current location", "city"], get: (p) => p.currentCity, learn: "currentCity", englishName: true },
  // 资料方案 fields: the direction-specific target role and self-assessment.
  // No `learn` here: which city and which job is usually picked per company.
  { keys: ["期望岗位", "期望职位", "意向岗位", "意向职位", "求职意向"], get: (p) => p.targetRole },
  { keys: ["自我评价", "个人评价", "自我描述"], get: (p) => p.selfIntro, learn: "selfIntro" },
  // Asked on most 校招 forms; filled by hand before these were in 网申资料.
  { keys: ["研究方向", "研究领域", "research direction", "research interest"], get: (p) => p.researchDirection, learn: "researchDirection" },
  { keys: ["成绩排名", "专业排名", "绩点排名", "年级排名", "班级排名", "排名"], not: /学校|院校|企业|公司|职位|岗位/, get: (p) => p.rank, learn: "rank" },
  { keys: ["主修课程", "专业课程", "核心课程", "主要课程"], get: (p) => p.courses, learn: "courses" },
  { keys: ["是否接受调剂", "服从调剂", "接受调剂", "岗位调剂", "是否服从"], not: /工作地|城市|地点/, get: (p) => p.acceptAdjust, learn: "acceptAdjust" },
  // 是否有交换生经历 (是 / 否) or a box for the exchange itself.
  { keys: ["交换生经历", "交换经历", "海外交换", "交换学习", "海外经历", "海外学习经历"], not: /是否接受|愿意|意向/, get: (p) => p.exchange, learn: "exchange", yesNo: true },
  { keys: ["是否学生干部", "是否担任学生干部", "是否担任过学生干部", "是否为学生干部"], get: (p) => (p.campus || []).some((row) => row.role) ? "是" : null },
  // Seen filled by hand on 腾讯、网易、歌尔、中国移动 after v1.20.
  { keys: ["个人主页", "个人网站", "作品链接", "作品集链接", "作品地址", "个人博客", "github", "portfolio", "personal website"], not: /linkedin|领英/i, get: (p) => p.homepage, learn: "homepage" },
  { keys: ["实验室", "课题组", "所在实验室", "研究组"], not: /是否|安全|有无/, get: (p) => p.lab, learn: "lab" },
  { keys: ["兴趣爱好", "个人爱好", "爱好特长", "爱好", "hobbies", "hobby"], get: (p) => p.hobbies, learn: "hobbies" },
  { keys: ["毕业论文", "学位论文", "论文题目", "thesis", "dissertation"], get: (p) => p.thesis, learn: "thesis" },
];

function basicKeyMatches(key, haystack) {
  if (!/^[\x20-\x7e]+$/.test(key)) return haystack.includes(key.toLowerCase());
  const word = key.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[\\s_-]*");
  return new RegExp(`(?:^|[^a-z])${word}(?:$|[^a-z])`).test(haystack);
}

function basicRuleMatches(rule, field) {
  const haystack = fieldHaystack(field);
  return rule.keys.some((key) => basicKeyMatches(key, haystack)) && !(rule.not && rule.not.test(haystack));
}

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

// label + placeholder + the name attribute split at camelCase/underscores,
// so "phoneNumber" and "legalName--firstName" read as words.
function fieldHaystack(field) {
  const name = String(field.name || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.[\]]+/g, " ");
  return `${field.label || ""} ${field.placeholder || ""} ${name}`.toLowerCase();
}

// 家庭成员 / 紧急联系人 / 推荐人 fields describe someone else: the applicant's
// own name, phone or employer must never land there, and nothing typed
// there is remembered as the applicant's own.
const THIRD_PARTY = /紧急联系人|联系人|家庭成员|家庭情况|家庭信息|家庭关系|家庭主要成员|主要家庭成员|家属|亲属|亲友|父母|父亲|母亲|配偶|爱人|子女|兄弟|姐妹|监护人|推荐人|内推人|介绍人|证明人|担保人|导师|社会关系|与本人关系|emergency|guardian|spouse|parent|father|mother|sibling|relative|next of kin|referee|references?\b|referr/i;

function isThirdPartyField(field) {
  if (THIRD_PARTY.test(fieldHaystack(field))) return true;
  // "个人及家庭信息" heads the applicant's own fields too; only a heading that
  // is purely about others marks every field under it.
  const section = String(field.section || "");
  return THIRD_PARTY.test(section) && !/个人|本人|基本|申请人|applicant|personal/i.test(section);
}

function isSplitNameField(field) {
  return /(?:^|\W)(?:first|last|given|family|middle|surname)(?:\s|[-_])*name(?:$|\W)|(?:^|\W)surname(?:$|\W)|姓氏|名字|名[（(]拼音|姓[（(]拼音|名的拼音|姓的拼音|(?:^|\s)[姓名](?:\s|$)/i.test(fieldHaystack(field));
}

function isOpenEndedQuestionField(field) {
  if (field.tag === "textarea" || field.tag === "richtext") return true;
  if (field.tag !== "input" || !["text", "", undefined].includes(field.type)) return false;
  const label = fieldHaystack(field);
  return /[?？]|为什么|为何|请描述|请介绍|请说明|谈谈|自我评价|个人优势|求职动机|职业规划|相关经历|why|describe|tell us|motivation|strength|experience|career plan|interested in/i.test(label);
}

function isSensitiveMemoryField(field) {
  return /身份证|证件|护照|银行卡|银行账号|卡号|密码|验证码|手机号|电话号码|邮箱地址|电子邮箱|详细地址|家庭住址|通讯地址|紧急联系人|家庭成员|出生日期|birth.?date|passport|password|captcha|bank.?account|phone.?number|email.?address|home.?address/i.test(fieldHaystack(field));
}

// Ordinary contact/education details can be remembered, but credentials,
// identity numbers and payment details never enter the reusable library —
// nor does anything about another person (a parent's name is not yours).
function isForbiddenMemoryField(field) {
  return isThirdPartyField(field) || /身份证|证件(?:号|号码)|护照|签名|密码|验证码|银行卡|银行账号|卡号|信用卡|支付|社保号|税号|紧急联系人|家庭成员|passport|password|captcha|bank.?account|credit.?card|social.?security|verification.?code|one.?time.?code/i.test(fieldHaystack(field));
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

/** The 网申资料 list a repeated block fills from. */
function listKey(group) {
  return group === "experience" ? "experiences" : group === "project" ? "projects" : group === "award" ? "awards" : group === "campus" ? "campus" : group === "skill" ? "skills" : group === "language" ? "languages" : "education";
}

// 校园经历 / 学生工作: student union, clubs, class roles — a list of its own,
// not an internship (seen filled by hand on 51job、中国移动、吉利、歌尔、智联).
const CAMPUS_SECTION = /校园经历|校内经历|在校经历|学生工作|学生干部|社团|校内(?:任职|职务|实践)|在校(?:任职|实践)|任职经历|组织经历|学生会|校园活动|campus|student (?:leadership|organi[sz]ation)|extracurricular/i;

// 专业技能 / 技能特长 (技能名称、掌握程度): a list of its own on Moka、网易、
// 中国移动、智联. 语言能力 and 技能证书 are other modules.
const SKILL_SECTION = /(?<!语言|外语)技能(?!证书)|专业特长|(?:^|\W)skills?(?:\W|$)/i;

// 语言能力 / 外语水平 (语种、考试、分数): one exam per row, 网申资料's 语言成绩.
const LANGUAGE_SECTION = /语言(?:能力|成绩|水平|证书|技能|考试)|外语(?:能力|水平|成绩|证书|技能|考试)|英语(?:能力|水平|成绩|考试)(?:情况)?$|^(?:外语|语言)$|language(?:s|\s*skills?|\s*proficiency|\s*tests?)?$/i;
// An exam named in the label itself ("雅思成绩", "IELTS") asks for that exam's row.
const EXAM_WORDS = /ielts|雅思|toefl|托福|cet\s*-?\s*[46]|(?<!专业|专业英语)[四六]级|专[四八]|专业(?:英语)?[四八]级|tem\s*-?\s*[48]|\bgre\b|gmat|托业|toeic|jlpt|日语能力/i;

function sectionGroup(section) {
  if (CAMPUS_SECTION.test(section)) return "campus";
  if (/获奖|荣誉|奖项|奖励|奖学金|评优|表彰|award|honou?r|scholarship/i.test(section)) return "award";
  if (SKILL_SECTION.test(section) && !/语言|外语|language/i.test(section)) return "skill";
  if (/项目|project/i.test(section)) return "project";
  if (/实习|工作经历|工作经验|实践经历|社会实践|internship|employment|work experience/i.test(section)) return "experience";
  if (/教育|学习经历|本科|硕士|研究生|博士|大专|专科|education|academic/i.test(section)) return "education";
  if (LANGUAGE_SECTION.test(section)) return "language";
  return null;
}

const AUTOFILL_MODULES = ["basic", "education", "experience", "project", "award", "campus", "skill", "questions", "other", "resume"];

function fieldModule(field, repeat) {
  if (isThirdPartyField(field)) return "other";
  // 语言成绩 fills with the 基本信息 it grew out of (英语水平), not a module of its own.
  if (repeat?.group === "language" || (!repeat && sectionGroup(field.section || "") === "language")) return "basic";
  if (/自我评价|个人评价|自我描述|个人优势|求职动机|职业规划/i.test(field.label || "")) return "questions";
  if (repeat) return repeat.group;
  const group = sectionGroup(field.section || "");
  if (group) return group;
  const section = String(field.section || "");
  if (/开放题|问答|自我评价|questions/i.test(section)) return "questions";
  if (/基本信息|个人信息|联系方式|求职意向|personal information|contact information/i.test(section)) return "basic";
  if (repeat) return repeat.group;
  if (isOpenEndedQuestionField(field)) return "questions";
  if (BASIC_FIELD_RULES.some((rule) => basicRuleMatches(rule, field)) || isSplitNameField(field)) return "basic";
  return "other";
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
  if (/院系|所在学院|学院名称|系别|^学院$/.test(bare || haystack) && !/学校|院校|大学|university|school/i.test(haystack)) return "department";
  if (/^(?:教育经历|教育背景|学习经历|education(?:background|experience)?)$/.test(bare)) return "summary";
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

// 公司行业 / 单位性质 / 公司规模 / 单位地址 describe the employer; they are not its name.
const ABOUT_EMPLOYER = /行业|性质|规模|类型|类别|地址|城市|所在地|地点|电话|网址|industry|size|type|address|city|location|phone/i;

function experienceFieldKind(haystack, inSection, bare = "") {
  if (/^(?:实习经历|工作经历|工作经验|实习情况|workexperience|internshipexperience)$/.test(bare)) return "summary";
  if (inSection && /描述|内容|职责|业绩|成果|description|responsibilit|achievement/i.test(haystack)) return "description";
  if (/实习(?:单位|公司|企业|机构)|工作单位|任职(?:单位|公司)/.test(haystack)) return ABOUT_EMPLOYER.test(haystack) ? null : "company";
  if (!inSection) return null;
  if (/部门|department/i.test(haystack)) return "department";
  if (/公司|单位|企业|机构|company|employer|organi[sz]ation/i.test(haystack)) return ABOUT_EMPLOYER.test(haystack) ? null : "company";
  if (/职位|岗位|职务|角色|title|position|role/i.test(haystack)) return "role";
  if (START_LABEL.test(haystack) && !NOT_A_DATE.test(haystack)) return "start";
  if (END_LABEL.test(haystack) && !NOT_A_DATE.test(haystack)) return "end";
  if (RANGE_LABEL.test(bare)) return "range";
  return null;
}

const SCHOLARSHIP_AWARD = /奖学金|scholarship/i;
const HONOR_AWARD = /三好|优秀|先进|标兵|模范|表彰|称号|荣誉称号/;
function awardPick(text) {
  if (SCHOLARSHIP_AWARD.test(text)) return "scholarship";
  if (/评优|表彰/.test(text)) return "honor";
  return "";
}

function awardFieldKind(haystack, bare, inSection) {
  // 「获奖项」「获奖项目」「所获奖项」 (zhiye / 石头科技) name the award as well.
  if (/(?:奖项|获奖|荣誉|奖励|奖学金|评优表彰|评优|表彰)名称|award[ _-]*(?:name|title)|scholarship[ _-]*(?:name|title)/i.test(haystack) || /^(?:获奖项目?|所获奖项|获得奖项|奖项名|荣誉称号)$/.test(bare) || (inSection && /^(?:名称|奖项|荣誉|奖励|name|title)$/.test(bare))) return "name";
  if (!inSection && !/获奖|奖项|荣誉|奖励|颁奖|award/i.test(haystack)) return null;
  if (/颁发|颁奖|授予|单位|机构|issuer|organi[sz]ation/i.test(haystack)) return "issuer";
  if (/等级|级别|奖级|奖等|level|grade/i.test(haystack)) return "level";
  if (/日期|时间|年月|年度|date|year/i.test(haystack)) return "date";
  if (/描述|说明|介绍|内容|description|details/i.test(haystack)) return "description";
  if (/^(?:获奖情况|获奖经历|荣誉奖励|荣誉奖项|奖励荣誉|奖励情况|受到(?:的)?奖励|所获(?:奖励|荣誉|奖项)|获得(?:的)?(?:奖励|荣誉|奖项)|奖惩(?:情况|经历)?|在校获奖(?:情况)?|获奖|奖励|awards?|honou?rs?)$/.test(bare)) return "summary";
  return null;
}

// One box for the whole list ("校内活动"), sometimes inside the 教育经历 block.
const CAMPUS_SUMMARY = /^(?:校内活动|校园活动|在校活动|校园经历|校内经历|在校经历|社会工作|学生工作|社团经历|社团活动|校内职务|在校任职|学生干部经历)$/;

function campusFieldKind(haystack, bare = "", inSection = false) {
  if (CAMPUS_SUMMARY.test(bare)) return "summary";
  if (!inSection && !/校内|在校|干部|社团|学生会|组织|团体|协会|班级/.test(haystack)) return null;
  if (/是否/.test(haystack)) return null;
  if (/(?:所在|学生)?组织(?:团体)?(?:名称)?|社团|团体名称|协会|学生会/.test(haystack) && !/职务|级别|描述|职位|角色/.test(haystack)) return "name";
  if (/级别|层级/.test(haystack)) return "level";
  if (/职务|干部名称|职位|角色|任职/.test(haystack)) return "role";
  if (!inSection) return /描述|说明|经历/.test(haystack) && /干部|校内|社团|组织/.test(haystack) ? "description" : null;
  if (RANGE_LABEL.test(bare)) return "range";
  if (START_LABEL.test(haystack)) return "start";
  if (END_LABEL.test(haystack)) return "end";
  if (/描述|内容|职责|成就|成果|主要工作|说明|description|details/i.test(haystack)) return "description";
  if (/^(?:名称|组织|单位)$|活动(?:名称)?$|^实践(?:名称|项目|单位)$|^(?:校园|校内|在校|学生)?(?:经历|工作|任职)(?:名称|名)$/.test(bare)) return "name";
  return null;
}

function projectFieldKind(haystack, bare = "", inSection = false) {
  if (/项目(?:名称|名)(?!称)|project[\s_-]*(?:name|title)/i.test(haystack)) return "name";
  if (/项目(?:角色|职位|职务)|project[\s_-]*role/i.test(haystack)) return "role";
  if (/项目(?:开始|起始)|project[\s_-]*start/i.test(haystack)) return "start";
  if (/项目(?:结束|截止)|project[\s_-]*end/i.test(haystack)) return "end";
  if (/项目(?:职责|负责|贡献|成果)|project[\s_-]*(?:responsibilit|contribution|achievement)/i.test(haystack)) return "responsibilities";
  if (/项目(?:描述|简介|介绍|内容|简述|概述|概况|背景)|project[\s_-]*(?:description|summary|overview)/i.test(haystack)) return "description";
  if (/项目(?:链接|网址|地址)|project[\s_-]*(?:link|url)|demo[\s_-]*(?:link|url)/i.test(haystack)) return "link";
  if (/^(?:项目经历|projectexperience)$/.test(bare)) return "summary";
  if (!inSection) return null;
  if (/^(?:链接|网址|地址|link|url)$/.test(bare)) return "link";
  if (/^(?:名称|name|title)$/.test(bare)) return "name";
  if (/^(?:角色|担任角色|职务|担任职务|role)$/.test(bare)) return "role";
  if (/^(?:开始(?:时间|日期)?|起始(?:时间|日期)?|start(?:date)?)$/.test(bare)) return "start";
  if (/^(?:结束(?:时间|日期)?|截止(?:时间|日期)?|end(?:date)?)$/.test(bare)) return "end";
  if (RANGE_LABEL.test(bare)) return "range";
  if (/职责|负责|贡献|成果|个人工作|本人工作|主要工作|承担|responsibilit|achievement/.test(bare)) return "responsibilities";
  if (/描述|简介|介绍|内容|简述|概述|description/.test(bare)) return "description";
  return null;
}

const EXAM_NAMES = { cet4: "CET-4", cet6: "CET-6", tem4: "专业四级", tem8: "专业八级", ielts: "雅思", toefl: "托福", gre: "GRE", gmat: "GMAT", toeic: "托业", jlpt: "日语能力考试" };

function examKey(text) {
  const value = String(text || "");
  for (const [key, pattern] of [["tem8", /tem\s*-?\s*8|专业?(?:英语)?八级|专八/i], ["tem4", /tem\s*-?\s*4|专业(?:英语)?四级|专四/i], ["cet6", /cet\s*-?\s*6|六级/i], ["cet4", /cet\s*-?\s*4|四级/i], ["ielts", /ielts|雅思/i], ["toefl", /toefl|托福/i], ["gre", /\bgre\b/i], ["gmat", /gmat/i], ["toeic", /toeic|托业/i], ["jlpt", /jlpt|日语能力|日语\s*n[1-5]/i]]) if (pattern.test(value)) return key;
  return "";
}

// 语种 / 考试类型 / 分数 / 考试时间 inside a 语言能力 block, or a box named after
// one exam ("六级成绩", "IELTS") anywhere — that box asks for the score.
function languageFieldKind(field, haystack, bare = "", inSection = false) {
  // 京东's lone "语言考试成绩" box is typed as "CET-6 560": the exam with its score, one exam per box.
  if (/^(?:语言|外语|英语)考试(?:成绩|情况)$/.test(bare) && !field.options && (field.tag === "textarea" || field.tag === "richtext" || !field.maxLength || field.maxLength >= 12)) return "name";
  if (/^(?:语言能力|外语能力|外语水平|语言水平|语言成绩|外语成绩|英语水平|languages?|languageskills?|languageproficiency)$/i.test(bare)) return inSection && (field.tag === "textarea" || field.tag === "richtext") ? "summary" : null;
  const named = EXAM_WORDS.test(bare);
  // "语言分数" ×2 without a heading (海尔): each box is a row's score.
  const looseScore = /^(?:(?:语言|外语|英语)(?:考试)?|考试)(?:分数|成绩|得分)$/.test(bare);
  if (!inSection && !named && !looseScore) return null;
  if (/是否|有无|证书编号|编号|准考证|number|\bid\b/i.test(haystack)) return null;
  if (/时间|日期|年月|年份|date|when|year/i.test(haystack)) return "date";
  if (/成绩|分数|得分|总分|分值|score|marks?\b|result|grade/i.test(haystack) || (named && !field.options)) return "score";
  if (/语种|^语言$|^外语$|^language$|language(?:type|name)/i.test(bare)) return "language";
  if (/考试|证书|等级|级别|水平|类型|类别|名称|exam|test|certificat|level|type|name/i.test(haystack) || named) return "name";
  return null;
}

// 技能名称 / 掌握程度 / 技能类别 rows. Language levels belong to 英语, certificates elsewhere.
function skillFieldKind(field, haystack, bare = "", inSection = false) {
  if (/语言|外语|英语|语种|证书|language|certific/i.test(haystack)) return null;
  if (/^(?:专业技能|技能特长|个人技能|掌握技能|技能|专业特长|skills?)$/i.test(bare)) return inSection && field.tag !== "textarea" && field.tag !== "richtext" ? "name" : "summary";
  const named = /技能|skill/i.test(haystack);
  if (!inSection && !named) return null;
  if (/类别|类型|分类|category|type/i.test(haystack)) return "category";
  if (/程度|水平|等级|熟练|level|proficiency/i.test(haystack)) return "level";
  if (/描述|说明|介绍|详情|备注|description|detail/i.test(haystack)) return "description";
  // 使用时长 / 年限: not something 网申资料 keeps.
  if (/时长|年限|时间|月数|duration|years?|months?/i.test(haystack)) return null;
  if (/名称|名$|^名|name/i.test(bare) || (inSection && /^(?:内容|技能项)$/.test(bare))) return "name";
  return null;
}

// Classifies a field and consumes its row. `rowIndexes` counts rows per
// "group:kind" across the whole scan (prefilled fields included), so it must
// be called once for every scanned field, in page order.
function resolveRepeatField(field, rowIndexes) {
  // A family member's 工作单位 is not one of the applicant's internships.
  if (isSplitNameField(field) || isThirdPartyField(field)) return null;
  if (/[?？]|为什么|为何|谈谈|你(?:的|在|如何)|如何|遇到|挑战|收获|\bwhy\b|\bhow\b|tell us/i.test(field.label || "")) return null;
  const bare = bareLabel(field);
  // "是否 211 院校" / "有无海外经历" ask about a row; they are never its school or name.
  if (/^(?:是否|有无|是不是)/.test(bare) || (field.options?.length && field.options.every((option) => /^(?:是|否|有|无|yes|no)$/i.test(String(option).trim())))) return null;
  const haystack = fieldHaystack(field);
  const section = String(field.section || "");
  const group = sectionGroup(section);
  let info = null;
  const languageKind = !group || group === "language" ? languageFieldKind(field, haystack, bare, group === "language") : null;
  if (languageKind) info = { group: "language", kind: languageKind, exam: examKey(bare) };
  const awardKind = info ? null : awardFieldKind(haystack, bare, group === "award");
  // 奖学金 / 评优表彰 are lists of their own on 京东: each takes only its own kind of award.
  if (awardKind) info = { group: "award", kind: awardKind, pick: awardPick(`${section} ${field.label || ""}`) };
  const projectKind = info ? null : projectFieldKind(haystack, bare, group === "project");
  if (!info && projectKind) info = { group: "project", kind: projectKind };
  if (!info && (!group || group === "skill")) {
    const kind = skillFieldKind(field, haystack, bare, group === "skill");
    if (kind) info = { group: "skill", kind };
  }
  if (!info && ((group !== "experience" && group !== "education") || CAMPUS_SUMMARY.test(bare))) {
    const kind = campusFieldKind(haystack, bare, group === "campus");
    if (kind) info = { group: "campus", kind };
  }
  if (!info && group === "experience") {
    const kind = experienceFieldKind(haystack, true, bare);
    if (kind) info = { group: "experience", kind };
  }
  if (!info) {
    const kind = educationFieldKind(haystack, group === "education", bare);
    if (kind) info = { group: "education", kind };
  }
  if (!info) {
    const kind = experienceFieldKind(haystack, false, bare);
    if (kind) info = { group: "experience", kind };
  }
  if (!info) return null;
  if (field.rangePart && info.kind === "range") info = { ...info, kind: field.rangePart };
  // A stray "预计毕业时间" in 基本信息 must not push the education blocks
  // below it down a row, so in-block and loose fields count separately.
  const pickTag = info.pick ? `:${info.pick}` : "";
  const key = `${info.group}${pickTag}:${info.kind}:${group === info.group ? "in" : "out"}`;
  // The 月 / 日 dropdown of a split date continues its 年 dropdown's row.
  const continuesDate = field.datePart === "month" || field.datePart === "day";
  const counted = continuesDate ? Math.max(0, (rowIndexes?.get(key) || 1) - 1) : rowIndexes?.get(key) || 0;
  if (!continuesDate) rowIndexes?.set(key, counted + 1);
  const anchor = info.group === "experience" ? "company" : info.group === "education" ? "school" : "name";
  const anchorKey = `${info.group}${pickTag}:anchor:${group === info.group ? "in" : "out"}`;
  if (info.kind === anchor) rowIndexes?.set(anchorKey, counted);
  const ordinal = sectionOrdinal(section);
  // The degree field's own label ("学历（本科及以上）") is a requirement, not a row.
  const hint = info.group === "education" ? degreeLevel(`${info.kind === "degree" ? "" : field.label || ""} ${group === "education" ? section : ""}`) : 0;
  let row = ordinal ?? (info.kind === "summary" ? counted : Math.max(counted, rowIndexes?.get(anchorKey) || 0));
  if (field.blockKey && rowIndexes) {
    const block = `block:${info.group}:${field.blockKey}`;
    if (!rowIndexes.has(block)) {
      const next = rowIndexes.get(`blocks:${info.group}`) || 0;
      rowIndexes.set(block, ordinal ?? next); rowIndexes.set(`blocks:${info.group}`, next + 1);
    }
    row = rowIndexes.get(block);
  }
  // A box for the whole list inside another module (智联's 校内活动 in 教育经历) takes all of it.
  return { ...info, row, degreeHint: hint, foreign: !!group && group !== info.group, blockKey: field.blockKey || `${info.group}${pickTag}:${hint ? `degree${hint}` : row}` };
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

function ageFromBirthDate(raw, now = new Date()) {
  const parts = dateParts(raw);
  if (!parts?.y) return null;
  const month = Number(parts.m) || 1, day = Number(parts.d) || 1;
  let age = now.getFullYear() - Number(parts.y);
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age--;
  return age >= 14 && age <= 80 ? String(age) : null;
}

function dateParts(raw) {
  const m = /(\d{4})(?:\s*[-./年]\s*(\d{1,2}))?(?:\s*[-./月]\s*(\d{1,2}))?/.exec(String(raw || ""));
  return m ? { y: m[1], m: m[2] ? m[2].padStart(2, "0") : "", d: m[3] ? m[3].padStart(2, "0") : "" } : null;
}

// What a date field expects: its own example ("2020.09", or "09/2024" on
// English forms), a format string ("YYYY-MM-DD", "MM/YYYY"), the picker's
// own type, its input type, or its wording (选择日期 → day, 月份 → month,
// 毕业年份 → year). Unknown fields keep yyyy-MM, the profile's own format.
function dateFormatFor(field) {
  const hint = `${field.placeholder || ""} ${field.label || ""} ${field.hint || ""}`;
  // (?!\d): in "2020.09-2024.06" the "-20" is the next year, not a day.
  const sample = /\d{4}\s*([-./年])\s*\d{1,2}(?:\s*([-./月])\s*\d{1,2}(?!\d))?/.exec(hint);
  if (sample) return { precision: sample[2] ? "day" : "month", sep: sample[1], order: "ymd" };
  const monthFirst = /(?<!\d)(\d{1,2})\s*([-./])\s*(?:(\d{1,2})\s*\2\s*)?\d{4}(?!\d)/.exec(hint);
  if (monthFirst) return { precision: monthFirst[3] ? "day" : "month", sep: monthFirst[2], order: monthFirst[3] ? (Number(monthFirst[1]) > 12 ? "dmy" : "mdy") : "my" };
  const pattern = /y{4}\s*([-./年])\s*m{2}(?:\s*[-./月]\s*d{2})?/i.exec(hint);
  if (pattern) return { precision: /d{2}/i.test(pattern[0]) ? "day" : "month", sep: pattern[1], order: "ymd" };
  const reversed = /\b(mm|dd)\s*([-./])\s*(?:(mm|dd)\s*\2\s*)?y{4}\b/i.exec(hint);
  if (reversed) return { precision: reversed[3] ? "day" : "month", sep: reversed[2], order: reversed[3] ? (reversed[1].toLowerCase() === "mm" ? "mdy" : "dmy") : "my" };
  if (/^year/.test(field.pickerType || "")) return { precision: "year", sep: "-", order: "ymd" };
  if (/^month/.test(field.pickerType || "")) return { precision: "month", sep: "-", order: "ymd" };
  if (/^(?:date|week)/.test(field.pickerType || "")) return { precision: "day", sep: "-", order: "ymd" };
  if (field.type === "date") return { precision: "day", sep: "-", order: "ymd" };
  if (field.type === "month") return { precision: "month", sep: "-", order: "ymd" };
  if (/年份|(?:^|\W)year(?:\W|$)/i.test(hint)) return { precision: "year", sep: "-", order: "ymd" };
  if (/月份|年月|month/i.test(hint)) return { precision: "month", sep: "-", order: "ymd" };
  if (/日期|date|生日|birthday/i.test(hint)) return { precision: "day", sep: "-", order: "ymd" };
  return { precision: "month", sep: "-", order: "ymd" };
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
  if (format.order === "my") return [parts.m, parts.y].join(format.sep);
  if (format.order === "mdy") return [parts.m, day, parts.y].join(format.sep);
  if (format.order === "dmy") return [day, parts.m, parts.y].join(format.sep);
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
  if (info.unmatched) return null;
  if (info.record) {
    const list = listKey(info.group);
    return repeatFieldValue(field, { ...info, record: null, row: 0, degreeHint: 0, pick: "" }, { ...profile, [list]: [info.record] });
  }
  if (info.all && info.kind === "summary") {
    if (info.summaryText) return info.summaryText;
    const rows = rowsForGroup(profile, info.group);
    return rows.map((_, row) => repeatFieldValue(field, { ...info, all: false, row }, profile)).filter(Boolean).join(info.group === "skill" ? "；" : "\n\n") || profile.summaries?.[info.group] || null;
  }
  if (info.group === "language") {
    const rows = languageRows(profile);
    // "雅思成绩" takes the 雅思 row whatever its position; none saved, nothing.
    const row = info.exam ? rows.find((item) => examKey(item.name) === info.exam) : rows[info.row];
    if (!row) return null;
    if (info.kind === "summary") return rows.map((item) => [item.name, item.score].filter(Boolean).join(" ")).join("；");
    if (info.kind === "date") return formatDateForField(field, row.date) || null;
    if (info.kind === "score") return field.options ? matchFieldOption(field, row.score) : row.score || null;
    if (info.kind === "language") {
      const language = row.language || (examKey(row.name) && examKey(row.name) !== "jlpt" ? "英语" : "");
      if (!language) return null;
      if (field.options) return field.options.find((option) => option === language) || field.options.find((option) => option.includes(language) || (/英语/.test(language) && /^english$/i.test(option))) || null;
      return /[㐀-鿿]/.test(field.label || "") || !/英语/.test(language) ? language : "English";
    }
    if (field.options) return englishValue({ ...field, label: "等级", placeholder: "", section: "" }, row.name);
    // A 等级 / 水平 text box takes the level with its score ("CET-6 560"); 考试 / 证书名称 just the name.
    return /等级|水平|level|考试成绩|考试情况/i.test(fieldHaystack(field)) ? [row.name, row.score].filter(Boolean).join(" ") : row.name;
  }
  if (info.group === "skill") {
    const row = profile.skills?.[info.row];
    if (!row) return null;
    if (info.kind === "summary") return [row.name, row.level && `（${row.level}）`, row.description && `：${row.description}`].filter(Boolean).join("");
    if (info.kind === "level") return skillLevelOption(field, row.level);
    return matchFieldOption(field, row[info.kind]);
  }
  if (info.group === "award") {
    const pool = (profile.awards || []).filter((item) => !info.pick || (info.pick === "scholarship" ? SCHOLARSHIP_AWARD : HONOR_AWARD).test(item?.name || ""));
    const award = pool[info.row];
    if (!award) return null;
    const value = info.kind === "date" ? formatDateForField(field, award.date) : info.kind === "summary" ? [award.name, award.level, award.issuer, award.date, award.description].filter(Boolean).join("；") : award[info.kind];
    return matchFieldOption(field, value);
  }
  if (info.group === "campus") {
    const row = profile.campus?.[info.row];
    if (!row) return null;
    const value = ["start", "end", "range"].includes(info.kind) ? rowDateValue(field, info.kind, row) : info.kind === "summary"
      ? [row.name, row.role, row.level, [row.start, row.end].filter(Boolean).join(" 至 "), row.description].filter(Boolean).join("；")
      : row[info.kind];
    return matchFieldOption(field, value);
  }
  if (info.group === "project") {
    const project = profile.projects?.[info.row];
    if (!project) return null;
    const value = ["start", "end", "range"].includes(info.kind) ? rowDateValue(field, info.kind, project) : info.kind === "summary"
      ? [project.name, project.role, project.description, project.responsibilities].filter(Boolean).join("；")
      : project[info.kind];
    return matchFieldOption(field, value);
  }
  if (info.group === "experience") {
    const experience = (profile.experiences || [])[info.row];
    return experience ? matchFieldOption(field, info.kind === "summary" ? [experience.company, experience.role, [experience.start, experience.end].filter(Boolean).join(" 至 "), experience.description].filter(Boolean).join("；") : rowDateValue(field, info.kind, experience)) : null;
  }
  const rows = educationRows(profile);
  // "本科院校" must never receive the 硕士 row just because it came first.
  const row = info.degreeHint ? rows.find((item) => degreeLevel(item.degree) === info.degreeHint) : rows[info.row];
  if (!row) return null;
  if (info.kind === "summary") return [row.school, row.degree, row.major, [row.start, row.end].filter(Boolean).join(" 至 "), row.gpa && `GPA ${row.gpa}`].filter(Boolean).join("；");
  return info.kind === "degree" ? matchDegreeOption(field, row.degree) : matchFieldOption(field, rowDateValue(field, info.kind, row));
}

// 了解 < 熟悉 < 熟练 < 精通, with each portal's own words for the four steps.
const SKILL_LEVELS = [
  ["了解", "一般", "入门", "初级", "基础", "basic", "beginner"],
  ["熟悉", "良好", "中级", "较熟练", "intermediate", "good"],
  ["熟练", "掌握", "较好", "advanced", "proficient"],
  ["精通", "专家", "高级", "expert", "master", "fluent"],
];

// The longest word decides: "较熟练" is a step below "熟练".
function skillLevelRank(text) {
  const value = String(text || "").toLowerCase();
  let best = { rank: -1, length: 0 };
  SKILL_LEVELS.forEach((words, rank) => { for (const word of words) if (value.includes(word) && word.length > best.length) best = { rank, length: word.length }; });
  return best.rank;
}

/** Words to try in a dropdown for a saved level: the same step first, then the nearest. */
function skillLevelAlternatives(level) {
  const rank = skillLevelRank(level);
  if (rank < 0) return [];
  return [...SKILL_LEVELS[rank], ...(SKILL_LEVELS[rank - 1] || []), ...(SKILL_LEVELS[rank + 1] || [])].filter((word) => word !== level);
}

function skillLevelOption(field, level) {
  if (!level) return null;
  if (!field.options) return level;
  const direct = matchFieldOption(field, level);
  if (direct) return direct;
  const rank = skillLevelRank(level);
  if (rank < 0) return null;
  const ranked = field.options.map((option) => ({ option, rank: skillLevelRank(option) })).filter((item) => item.rank >= 0).sort((a, b) => Math.abs(a.rank - rank) - Math.abs(b.rank - rank));
  return ranked[0]?.option || null;
}

function stableMemoryHash(value) {
  let hash = 14695981039346656037n;
  for (const char of value) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0))) * 1099511628211n);
  return hash.toString(16);
}

function rowsForGroup(profile, group, includeLibrary = false) {
  const list = listKey(group);
  const rows = group === "education" ? educationRows(profile) : group === "language" ? languageRows(profile) : [...(profile[list] || [])];
  if (includeLibrary) for (const entry of profile.library || []) {
    if (entry.category !== group || entry.content.text) continue;
    for (const [index, content] of [entry.content, ...(entry.alternatives || []).map((item) => item.content)].entries()) {
      const row = { ...content };
      Object.defineProperty(row, "__memoryRef", { value: `row:${group}:memory:${entry.id}:${stableMemoryHash(JSON.stringify(Object.entries(content).sort(([a], [b]) => a.localeCompare(b))))}` });
      Object.defineProperty(row, "__memoryLabel", { value: index ? `资料库 · 其他版本 ${index}` : "资料库 · 默认版" });
      rows.push(row);
    }
  }
  return rows;
}

// 语言成绩 rows; with none saved, the single 英语水平 text read as exams ("CET-6 580，雅思 7.0").
function languageRows(profile) {
  const saved = (profile.languages || []).filter((row) => row && row.name);
  if (saved.length) return saved.map((row) => ({ ...row }));
  return String(profile.english || "").split(/[，,；;、\/]|\s{2,}/).map((part) => part.trim()).filter(Boolean).map((part) => {
    const score = /(?:^|[\s：:])(\d{1,3}(?:\.\d)?)\s*分?$/.exec(part);
    const name = (score ? part.slice(0, score.index) : part).replace(/[：:\s]+$/, "").trim();
    return examKey(name) ? { name, language: "", score: score ? score[1] : "", date: "" } : null;
  }).filter(Boolean);
}

function recordReference(group, row) {
  if (row.__memoryRef) return row.__memoryRef;
  return `row:${group}:${encodeURIComponent(JSON.stringify([row.school || row.company || row.name || "", row.role || row.degree || row.level || "", row.start || row.date || "", row.end || row.issuer || ""]))}`;
}

/** One source per DOM block, aligned with existing names/dates instead of
 * blindly filling remaining fields from the first saved experience. */
// Portals where each 经历 must be saved before 「添加」 offers the next one
// show the saved ones as plain text cards, with one empty form below. Which
// saved records are already on the page as such a card: its name (school /
// company / project) plus its role, major or start month in the page text.
function normalizedPageText(text) {
  return String(text || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// The same for any module taken one entry at a time (语言、证书、技能、
// 校园活动…): the value about to go into the empty form is already in one of
// the entries saved above it. A name-like value decides; with none, all must.
const ENTRY_IDENTITY = /名称|名字|标题|活动|社团|组织|证书|语种|语言|技能|课程|学校|院校|公司|单位|项目|奖|职位|岗位|name|title|language|skill|certific/i;
const ENTRY_DETAIL = /时间|日期|年月|描述|内容|介绍|职责|角色|职务|等级|级别|程度|分数|成绩|说明|time|date|description|level|score/i;

function savedEntryHas(entries, value) {
  const key = normalizedPageText(value).slice(0, 40);
  return key.length >= 2 && entries.some((entry) => normalizedPageText(entry).includes(key));
}

function repeatsSavedEntry(entries, items) {
  const distinct = items.filter((item) => normalizedPageText(item.value).length >= 2);
  if (!distinct.length) return false;
  const identity = distinct.filter((item) => ENTRY_IDENTITY.test(item.label || "") && !ENTRY_DETAIL.test(item.label || ""));
  return identity.length ? identity.some((item) => savedEntryHas(entries, item.value)) : distinct.every((item) => savedEntryHas(entries, item.value));
}

function savedRecordsOnPage(profile, pageText) {
  const saved = new Map();
  const text = normalizedPageText(pageText);
  if (!text) return saved;
  const has = (value) => {
    const key = normalizedPageText(value);
    return key.length >= 2 && text.includes(key);
  };
  const month = (value) => {
    const match = /(\d{4})\D{0,3}(\d{1,2})/.exec(String(value || ""));
    return match ? `${match[1]}${match[2].padStart(2, "0")}` : "";
  };
  for (const group of ["education", "experience", "project", "award", "campus", "skill", "language"]) {
    const rows = rowsForGroup(profile, group);
    const found = new Set();
    rows.forEach((row, index) => {
      const name = group === "education" ? row.school : group === "experience" ? row.company : row.name;
      if (!name || !has(name)) return;
      const second = [row.major, row.role, row.level, row.degree, row.category, row.score].filter(Boolean).some(has) || [row.start, row.date].map(month).some((value) => value && text.includes(value));
      if (second) found.add(index);
    });
    // The same school twice (本科 + 硕士 at one university) cannot be told apart
    // by name; only trust the text when it is not ambiguous.
    const names = rows.map((row) => normalizedPageText(group === "education" ? row.school : group === "experience" ? row.company : row.name));
    for (const index of [...found]) if (names.filter((name) => name === names[index]).length > 1 && !(normalizedPageText(rows[index].major || rows[index].role || "") && has(rows[index].major || rows[index].role))) found.delete(index);
    if (found.size) saved.set(group, found);
  }
  return saved;
}

function classifyRepeatBlocks(fields, profile, pageText = "") {
  const rowIndexes = new Map(), repeats = new Map(), blocks = new Map();
  for (const field of fields) {
    const info = resolveRepeatField(field, rowIndexes);
    if (!info) continue;
    repeats.set(field.id, info);
    if (!blocks.has(info.blockKey)) blocks.set(info.blockKey, { id: info.blockKey, group: info.group, row: info.row, fields: [] });
    blocks.get(info.blockKey).fields.push(field);
  }
  const reserved = new Map();
  for (const block of blocks.values()) {
    const rows = rowsForGroup(profile, block.group);
    const known = block.fields.filter((field) => field.hasValue && field.currentValue && ["name", "company", "school", "role", "degree", "start", "end", "date"].includes(repeats.get(field.id).kind));
    if (!known.length) continue;
    const normalized = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    const candidates = rows.map((row, index) => ({ row, index })).filter(({ index }) => known.every((field) => {
      const info = repeats.get(field.id);
      const value = repeatFieldValue(field, { ...info, row: index, degreeHint: 0 }, profile);
      return value && normalized(value) === normalized(field.currentValue);
    }));
    block.unmatched = candidates.length !== 1;
    if (candidates.length === 1) {
      block.row = candidates[0].index;
      if (!reserved.has(block.group)) reserved.set(block.group, new Set());
      reserved.get(block.group).add(block.row);
    }
    block.anchored = true;
  }
  // Records already saved as cards on the page are taken too, so the empty
  // form below them gets the next one instead of the first one again.
  const savedOnPage = savedRecordsOnPage(profile, pageText);
  for (const [group, indexes] of savedOnPage) {
    // Only for a group whose fields are on the page, and never a record an
    // input block on the page already holds (it is that block's text).
    const held = reserved.get(group) || new Set();
    const cards = [...indexes].filter((index) => !held.has(index));
    if (!cards.length || ![...blocks.values()].some((block) => block.group === group)) continue;
    rowIndexes.set(`${group}:saved`, cards.length);
    reserved.set(group, new Set([...held, ...cards]));
  }
  // Unanchored blocks keep their row unless an anchored block took it.
  // Blocks sharing a nominal row share the record: one 教育 block whose
  // fields straddle two table rows is still one block, not two.
  const remapped = new Map();
  for (const block of blocks.values()) {
    if (!block.anchored) {
      const key = `${block.group}:${block.row}`;
      if (!remapped.has(key)) {
        const used = reserved.get(block.group) || new Set();
        const rows = rowsForGroup(profile, block.group);
        let row = block.row;
        if (used.has(row)) row = rows.findIndex((_, index) => !used.has(index));
        if (row >= 0) { used.add(row); reserved.set(block.group, used); }
        // Every record is already saved on the page: nothing left for this
        // empty form (filling the first one again would duplicate it).
        else if (rowIndexes.get(`${block.group}:saved`)) row = rows.length;
        remapped.set(key, row >= 0 ? row : block.row);
      }
      block.row = remapped.get(key);
    }
    const groupBlocks = [...blocks.values()].filter((other) => other.group === block.group);
    for (const field of block.fields) {
      const info = repeats.get(field.id);
      info.row = block.row; info.unmatched = block.unmatched;
      info.all = info.kind === "summary" && (info.foreign || (groupBlocks.length === 1 && block.fields.length === 1));
      const summaryMapping = info.all && (profile.mappings || []).find((item) => item.fieldKey === field.mappingKey && (item.ref === `summary:${block.group}` || item.ref?.startsWith(`summary:${block.group}:`)));
      if (summaryMapping) {
        info.summaryText = profileChoices(profile).find((choice) => choice.ref === summaryMapping.ref)?.value;
        info.summaryRef = summaryMapping.ref;
      }
    }
    if (!block.anchored) {
      const refs = new Set(block.fields.map((field) => (profile.mappings || []).find((item) => item.fieldKey === field.mappingKey)?.ref).filter((ref) => ref?.startsWith(`row:${block.group}:`)).map((ref) => ref.slice(0, ref.lastIndexOf(":"))));
      if (refs.size === 1) {
        const record = rowsForGroup(profile, block.group, true).find((row) => refs.has(recordReference(block.group, row)));
        if (record) for (const field of block.fields) repeats.get(field.id).record = record;
      }
    }
  }
  return { repeats, blocks: [...blocks.values()], rowIndexes };
}

function previewRecordBlocks(blocks, repeats, profile) {
  const labels = { education: "教育经历", experience: "实习 / 工作", project: "项目经历", award: "获奖情况", campus: "校园经历", skill: "专业技能", language: "语言成绩" };
  return blocks.map((block, index) => ({
    id: block.id, label: `${labels[block.group]} · ${block.fields[0].section || `第 ${index + 1} 段`}`,
    note: block.unmatched ? "网页已有的名称或日期无法唯一匹配，请核对这段经历后选择来源" : "整段选择一条经历，已有内容保持不动",
    fieldIds: block.fields.map((field) => field.id),
    choices: rowsForGroup(profile, block.group, true).map((row, rowIndex) => {
      const ref = recordReference(block.group, row);
      const one = { ...profile, [listKey(block.group)]: [row] };
      return { ref, label: [row.school || row.company || row.name || `经历 ${rowIndex + 1}`, row.role || row.degree || row.level, row.start || row.date, row.__memoryLabel].filter(Boolean).join(" · "),
        values: Object.fromEntries(block.fields.map((field) => [field.id, { value: repeatFieldValue(field, { ...repeats.get(field.id), record: null, summaryText: null, row: 0, degreeHint: 0, pick: "", unmatched: false, all: false }, one) || "", ref: `${ref}:${repeats.get(field.id).kind}` }])) };
    }).filter((choice) => block.fields.filter((field) => field.hasValue && field.currentValue && ["name", "company", "school", "role", "degree", "start", "end", "date"].includes(repeats.get(field.id).kind)).every((field) => {
      const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
      return normalize(choice.values[field.id]?.value) === normalize(field.currentValue);
    })).concat(block.fields.length === 1 && repeats.get(block.fields[0].id).all ? profileChoices(profile).filter((choice) => choice.ref === `summary:${block.group}` || choice.ref.startsWith(`summary:${block.group}:`)).map((choice) => ({ ref: choice.ref, label: choice.label, values: { [block.fields[0].id]: { value: choice.value, ref: choice.ref } } })) : []),
  }));
}

// One line per scanned field for the 逐字段结果 list: where the value came
// from, so checking a filled form means reading the AI and 需手填 rows, not
// every field. `source` drives the colour dot and grouping in the UI.
// "*姓名：" reads as 姓名 in our own lists.
function displayLabel(field) {
  return String(field.label || field.placeholder || field.name || "").replace(/^[*＊\s]+|[*＊：:\s]+$/g, "") || "未命名字段";
}

function fillDetail(field, pair, filledSet, failedSet) {
  const own = displayLabel(field);
  const label = field.section && !own.includes(field.section) && (sectionGroup(field.section) || THIRD_PARTY.test(field.section)) ? `${field.section} · ${own}` : own;
  if (field.hasValue || field.userEdited) return { label, state: field.userEdited ? "手动修改过，保持不动" : "页面已有内容，未改动", source: "prefilled" };
  if (isThirdPartyField(field)) return { label, state: "家庭成员 / 联系人等他人信息，请手填", source: "manual" };
  if (field.readonlyPicker) return { label, state: field.suggestion ? `日期需在网页上点选：${field.suggestion}` : "日期需在网页上点选", source: "manual" };
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
  // Cards already saved on the page count as shown.
  const seen = (group, kind) => Math.max(rowIndexes.get(`${group}:${kind}:in`) || 0, rowIndexes.get(`${group}:${kind}:out`) || 0) + (rowIndexes.get(`${group}:saved`) || 0);
  const checks = [
    ["education", "school", educationRows(profile).length, "教育经历"],
    ["experience", "company", (profile.experiences || []).length, "实习/工作经历"],
    ["project", "name", (profile.projects || []).length, "项目经历"],
    ["award", "name", (profile.awards || []).length, "获奖情况"],
    ["campus", "name", (profile.campus || []).length, "校园经历"],
    ["skill", "name", (profile.skills || []).length, "专业技能"],
    ["language", "name", (profile.languages || []).length, "语言成绩"],
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
    award: /获奖|奖项|荣誉|奖励|award|honou?r/i,
    campus: /校园|校内|在校|学生工作|学生干部|社团|任职|campus/i,
    skill: /技能|特长|skill/i,
    language: /语言|外语|英语|language/i,
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
  // A missing fact is not a prompt to invent an experience. Open questions
  // remain eligible for AI in their separate pass.
  if (info.unmatched || info.record || info.group === "award" || info.group === "campus" || info.group === "skill" || info.group === "language") return false;
  if (["description", "responsibilities", "summary", "link"].includes(info.kind)) return false;
  const saved = info.group === "education" ? educationRows(profile) : info.group === "experience" ? profile.experiences || [] : profile.projects || [];
  return saved.length === 0 && info.row === 0 && !info.degreeHint;
}

function matchFieldOption(field, value) {
  if (!value) return null;
  if (!field.options) return value;
  // 年 / 月 / 日 dropdowns of a split date take their own part of it.
  if (field.datePart) {
    const parts = dateParts(value);
    const wanted = parts ? Number(field.datePart === "year" ? parts.y : field.datePart === "month" ? parts.m : parts.d) : 0;
    return wanted ? field.options.find((option) => Number((/^\d{1,4}/.exec(option) || [])[0]) === wanted) || null : null;
  }
  const exact = field.options.find((option) => option === value);
  if (exact) return exact;
  const fuzzy = field.options.filter((option) => option.includes(value) || value.includes(option));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

// A mainland mobile is wanted as its 11 digits by nearly every form;
// anything else only loses its spacing when the box is too short for it.
function normalizePhone(field, value) {
  const raw = String(value).trim();
  const compact = raw.replace(/[\s\-()（）]/g, "");
  if (/^(?:\+?86)?1[3-9]\d{9}$/.test(compact)) return compact.replace(/^\+?86/, "");
  return field.maxLength && raw.length > field.maxLength ? compact : raw;
}

// Most specific first: 专业八级 before 四级, CET-6 before CET-4.
const ENGLISH_LEVELS = [
  [/tem\s*-?\s*8|专业?(?:英语)?八级|专八/i, /八级|tem\s*-?\s*8|专八/i],
  [/tem\s*-?\s*4|专业(?:英语)?四级|专四/i, /专业(?:英语)?四级|专四|tem\s*-?\s*4/i],
  [/cet\s*-?\s*6|六级/i, /六级|cet\s*-?\s*6/i],
  [/cet\s*-?\s*4|(?<!专业|专业英语)四级/i, /(?<!专业|专业英语)四级|cet\s*-?\s*4/i],
  [/ielts|雅思/i, /ielts|雅思/i],
  [/toefl|托福/i, /toefl|托福/i],
];

// "CET-6 560" against what the field actually asks: the level dropdown
// (大学英语六级), the score box (560) or the language itself (英语).
function englishValue(field, value) {
  const text = fieldHaystack(field);
  if (/成绩|分数|得分|score|marks?\b/i.test(text)) return field.options ? null : (/\d{2,3}(?:\.\d)?/.exec(String(value)) || [null])[0];
  if (/语种|language/i.test(text) && !/水平|等级|能力|level|proficiency|skill/i.test(text)) {
    if (field.options) return field.options.find((option) => /^(?:英语|english)$/i.test(option)) || null;
    return /[㐀-鿿]/.test(field.label || "") ? "英语" : "English";
  }
  if (!field.options) return value;
  for (const [has, option] of ENGLISH_LEVELS) {
    if (!has.test(value)) continue;
    const found = field.options.filter((item) => option.test(item));
    if (found.length === 1) return found[0];
  }
  return matchFieldOption(field, value);
}

// Deterministic answers for the phone type and country-code choices that
// sit next to a mainland mobile number on English forms.
function matchPhoneChoice(field, profile) {
  if (!/^(?:\+?86)?1[3-9]\d{9}$/.test(String(profile.phone || "").replace(/[\s\-()（）]/g, ""))) return null;
  const text = fieldHaystack(field);
  if (/country.{0,12}code|phone.{0,6}code|dialing code|国家.{0,4}代码|地区.{0,4}代码|国际区号|国家\/地区号码/.test(text)) {
    if (field.options) return field.options.filter((option) => /\+\s*86(?!\d)|中国大陆|^中国|china/i.test(option) && !/香港|澳门|台湾|hong kong|macau|macao|taiwan/i.test(option)).sort((a, b) => a.length - b.length)[0] || null;
    return field.tag === "custom-select" || field.tag === "input" ? "+86" : null;
  }
  if (field.options && /phone.{0,8}(?:device|type)|电话类型|号码类型/.test(text)) return field.options.find((option) => /^(?:mobile|cell|手机|移动电话)/i.test(option)) || null;
  return null;
}

// Places as an English form wants them: "上海" → "Shanghai", "新加坡" → "Singapore".
const PLACE_NAMES = { 中国: "China", 中国大陆: "China", 新加坡: "Singapore", 香港: "Hong Kong", 澳门: "Macao", 台湾: "Taiwan", 美国: "United States", 英国: "United Kingdom", 日本: "Japan", 韩国: "South Korea", 马来西亚: "Malaysia", 澳大利亚: "Australia", 加拿大: "Canada", 德国: "Germany", 法国: "France",
  北京: "Beijing", 上海: "Shanghai", 深圳: "Shenzhen", 广州: "Guangzhou", 杭州: "Hangzhou", 南京: "Nanjing", 苏州: "Suzhou", 成都: "Chengdu", 武汉: "Wuhan", 西安: "Xi'an", 天津: "Tianjin", 重庆: "Chongqing", 长沙: "Changsha", 厦门: "Xiamen", 青岛: "Qingdao", 合肥: "Hefei", 无锡: "Wuxi", 宁波: "Ningbo", 郑州: "Zhengzhou", 济南: "Jinan", 大连: "Dalian", 沈阳: "Shenyang", 珠海: "Zhuhai", 东莞: "Dongguan", 佛山: "Foshan", 福州: "Fuzhou", 昆明: "Kunming", 南昌: "Nanchang", 常州: "Changzhou", 潍坊: "Weifang", 烟台: "Yantai" };
const OVERSEAS_PLACES = { 新加坡: "新加坡", 香港: "香港", 澳门: "澳门", 台湾: "台湾", 美国: "美国", 英国: "英国", 日本: "日本", 韩国: "韩国", 马来西亚: "马来西亚", 澳大利亚: "澳大利亚", 加拿大: "加拿大", 德国: "德国", 法国: "法国" };

/** The country a saved 现居城市 is in: 新加坡 → 新加坡, a mainland city → 中国. */
function countryFromCity(city) {
  const text = String(city || "").replace(/[市省]$/, "").trim();
  if (!text) return null;
  const overseas = Object.keys(OVERSEAS_PLACES).find((name) => text.includes(name));
  if (overseas) return overseas;
  return Object.keys(PLACE_NAMES).some((name) => !OVERSEAS_PLACES[name] && text.includes(name)) ? "中国" : null;
}

function placeForField(field, value) {
  const text = String(value || "").trim();
  if (!/[㐀-鿿]/.test(text)) return text;
  const own = `${field.label || ""}${field.placeholder || ""}`;
  const english = (/[a-z]/i.test(own) && !/[㐀-鿿]/.test(own)) || (field.options?.length && field.options.every((option) => !/[㐀-鿿]/.test(option)));
  if (!english) return text;
  const name = Object.keys(PLACE_NAMES).sort((a, b) => b.length - a.length).find((key) => text.replace(/[市省]$/, "") === key || text.startsWith(key));
  if (!name) return text;
  if (field.options) return field.options.find((option) => option.toLowerCase() === PLACE_NAMES[name].toLowerCase()) || field.options.find((option) => option.toLowerCase().startsWith(PLACE_NAMES[name].toLowerCase())) || PLACE_NAMES[name];
  return PLACE_NAMES[name];
}

function matchFlatField(field, profile) {
  if (isThirdPartyField(field)) return null;
  const haystack = fieldHaystack(field);
  // Broad English tokens often occur inside a different question's label.
  if (/company.?name|employer.?name|school.?name|岗位名称|公司名称|企业名称/.test(haystack)) return null;
  const phoneChoice = matchPhoneChoice(field, profile);
  if (phoneChoice) return phoneChoice;
  // Inside a 语言能力 module the bare 语种 / 等级 / 证书 boxes are about English.
  if (profile.english && /语言|外语|英语|language/i.test(field.section || "") && /语种|等级|证书|成绩|分数|水平|level|score|certificat|language/i.test(haystack)) {
    const english = englishValue(field, String(profile.english));
    if (english) return english;
  }
  for (const rule of BASIC_FIELD_RULES) {
    if (!basicRuleMatches(rule, field)) continue;
    let value = rule.get(profile);
    if (!value) continue;
    if (rule.phone) value = normalizePhone(field, value);
    if (rule.english) {
      const english = englishValue(field, String(value));
      if (english) return english;
      continue;
    }
    // Dates follow the field's own precision and format (出生年月 → 2002-03).
    if (rule.exactDay && !dateParts(value)?.d && dateFormatFor(field).precision === "day" && !field.options) continue;
    if (rule.date) value = formatDateForField(field, value) || (field.options ? value : "");
    if (!value) continue;
    if (rule.englishName) value = placeForField(field, value);
    // A yes / no choice takes 否 for 「无」 and 是 for anything describing one.
    if (rule.yesNo && field.options?.length && field.options.every((option) => /^(?:是|否|有|无|没有|yes|no)$/i.test(String(option).trim()))) {
      const none = /^(?:无|否|没有|暂无|no|none|n\/?a)$/i.test(String(value).trim());
      const found = field.options.find((option) => (none ? /^(?:否|无|没有|no)$/i : /^(?:是|有|yes)$/i).test(String(option).trim()));
      if (found) return found;
      continue;
    }
    // A choice field still has to hit one of its own options.
    const matched = rule.degree ? matchDegreeOption(field, value) : matchFieldOption(field, value);
    if (matched) return matched;
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

// The 网申资料 field a hand-typed answer in this box would fill: the same
// rule that fills the box, so nothing is learned that would not be used.
function learnableProfileKey(field) {
  if (isThirdPartyField(field) || isNeverGuessField(field)) return null;
  const haystack = fieldHaystack(field);
  if (/company.?name|employer.?name|school.?name|岗位名称|公司名称|企业名称/.test(haystack)) return null;
  const rule = BASIC_FIELD_RULES.find((item) => basicRuleMatches(item, field));
  if (!rule || !rule.learn) return null;
  // A score box ("英语成绩 580") holds part of the level, not the level.
  if (rule.english && /成绩|分数|得分|score/i.test(haystack)) return null;
  return rule.learn;
}

function isNeverGuessField(field) {
  const haystack = fieldHaystack(field);
  return isSplitNameField(field) || NEVER_GUESS_KEYWORDS.some((k) => haystack.includes(k.toLowerCase()));
}

function portalContext(rawUrl) {
  const url = new URL(rawUrl);
  const sharedHost = /(?:^|\.)(?:mokahr\.com|beisen\.com|zhaopin\.com|zhipin\.com|liepin\.com|51job\.com|lagou\.com|nowcoder\.com|shixiseng\.com)$/i.test(url.hostname);
  const tenant = [...url.searchParams].filter(([key]) => /^(?:company|companyId|tenant|tenantId|organization|orgid|brand|recruitment)$/i.test(key)).sort(([a], [b]) => a.localeCompare(b));
  // An explicit tenant on a recognised shared portal is stable across steps.
  // Unknown hosts, query-routed tenants and SPA routes stay page-specific.
  // v2 prevents reuse of legacy origin-only memories; never truncate identity.
  if (sharedHost && tenant.length) return `tenant:v2:${url.origin}?${new URLSearchParams(tenant)}`;
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return `page:v2:${url.href}`;
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
    if (input.disabled || input.files?.length) continue;
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

// Injected: the page's visible text (saved 经历 cards are plain text, not inputs).
// 「这页没填好」: the page's form skeleton for reproducing a fill problem,
// with what the applicant wrote taken out. Runs inside the page. Values,
// editable text and anything long or personal-looking in text nodes are
// dropped; labels, layout, classes and option names stay, since those are
// what the fill engine reads.
function formSkeleton() {
  const PERSONAL = /@|\d{5,}|[\w.-]+\.(com|cn|net|org)\b/i;
  const root = document.body ? document.body.cloneNode(true) : document.createElement("body");
  root.querySelectorAll("script, style, noscript, svg, img, video, audio, canvas, iframe, link, meta, template").forEach((node) => node.remove());
  root.querySelectorAll("input, textarea").forEach((el) => {
    el.removeAttribute("value");
    if (el.tagName === "TEXTAREA") el.textContent = "";
    if (el.type === "password" || el.type === "hidden") el.remove();
  });
  root.querySelectorAll("[contenteditable]").forEach((el) => { el.textContent = ""; });
  root.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^(on|data-cp-)|^(style|src|href|srcset|value|title|alt|selected|checked)$/i.test(attr.name) || PERSONAL.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const node of texts) {
    const text = node.textContent.replace(/\s+/g, " ").trim();
    node.textContent = !text ? "" : text.length > 24 || PERSONAL.test(text) ? "…" : text;
  }
  return root.outerHTML.slice(0, 600000);
}

function readPageText() {
  return String((document.body && document.body.innerText) || "").slice(0, 80000);
}

async function scanFrames(adapter) {
  const frames = await adapter.frames();
  const fields = [];
  let pageText = "";
  const frameById = new Map();
  const run = Date.now().toString(36).slice(-4);
  for (let i = 0; i < frames.length; i++) {
    try {
      await adapter.run(frames[i], trackUserEdits, []);
      const found = await adapter.run(frames[i], scanPageFields, [`c${i}${run}-`]);
      await adapter.run(frames[i], readCurrentApplicationFields, []);
      await adapter.run(frames[i], watchApplicationFields, [adapter.archiveScope?.() || portalContext(adapter.url())]).catch(() => {});
      for (const f of found || []) {
        frameById.set(f.id, frames[i]);
        fields.push(f);
      }
      if (found && found.length) pageText += `\n${await adapter.run(frames[i], readPageText, []).catch(() => "")}`;
    } catch {
      // A frame that refuses scripts (sandboxed ad iframe, about:blank) has no form anyway.
    }
  }
  return { fields, frameById, pageText };
}

async function fillFrames(adapter, pairs, frameById, initialUrl) {
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
    if (!adapter.stillOnPage(initialUrl)) throw new Error("页面或标签已切换，已停止写入；请在当前页面重新填充");
    const plain = subset.filter((p) => !/-s\d+$/.test(p.id));
    const custom = subset.filter((p) => /-s\d+$/.test(p.id));
    for (const [batch, writer] of [[plain, fillFields], [custom, fillCustomSelects]]) {
      if (!batch.length) continue;
      if (!adapter.stillOnPage(initialUrl)) throw new Error("页面或标签已切换，已停止写入");
      try {
        const result = await adapter.run(frame, writer, writer === fillCustomSelects ? [batch, adapter.taskId] : [batch]);
        filled.push(...result.filled);
        failed.push(...result.failed);
        skipped.push(...(result.skipped || []));
      } catch {
        failed.push(...batch.map((p) => p.label || p.id));
      }
    }
  }
  return { filled, failed, skipped };
}

// `options`: { variantId, expandBlocks } from the UI, plus round/modal/added
// carried between 自动补齐栏目 rounds.
async function runAutofillCore(adapter, resumeVersionId, options = {}) {
  const initialUrl = adapter.url();
  const priorPlan = adapter.getPlan?.();
  const assertActive = () => {
    if (!adapter.stillOnPage(initialUrl)) throw new Error(adapter.stopReason?.() || "页面或标签已切换，已停止写入；请在当前页面重新填充");
  };
  try {
    const modules = new Set(Array.isArray(options.modules) ? options.modules.filter((id) => AUTOFILL_MODULES.includes(id)) : AUTOFILL_MODULES);
    if (!modules.size) throw new Error("请先在「填写范围」里至少勾选一个模块");
    assertActive();
    adapter.status({ phase: "scanning", message: "正在读取页面…" });

    const profileQuery = new URLSearchParams({ contextKey: options.positionId ? `job:v1:${options.positionId}` : portalContext(initialUrl) });
    if (options.variantId) profileQuery.set("variantId", options.variantId);
    if (resumeVersionId) profileQuery.set("resumeVersionId", resumeVersionId);
    const profileRes = await adapter.api(`profile?${profileQuery}`);
    if (!profileRes.ok) throw new Error("拿不到你的资料，先去求职罗盘的账号设置填一下");
    const profile = await profileRes.json();

    assertActive();
    const { fields, frameById, pageText } = await scanFrames(adapter);
    assertActive();
    // A page may only contain an upload control. Keep going when a resume
    // is selected so the attachment pass below still gets a chance to run.
    if (fields.length === 0 && !resumeVersionId) throw new Error("这个页面上没找到可以填的表单——如果表单在弹窗里，先把它打开");

    const pairs = [];
    let candidates = []; // fields going to AI: {id, label, kind, options?}
    const { repeats, blocks, rowIndexes } = classifyRepeatBlocks(fields, profile, pageText);
    const pageContext = options.positionId ? `job:v1:${options.positionId}` : portalContext(initialUrl);
    let neverGuessCount = 0;
    let alreadyFilled = 0;
    let thirdPartyCount = 0;
    let pickOnPageCount = 0;
    const excluded = new Set();
    for (const field of fields) {
      // Classify before skipping prefilled fields: a filled first education
      // block still occupies row one, so the next empty "学校" gets row two.
      const repeat = repeats.get(field.id);
      if (!modules.has(fieldModule(field, repeat))) {
        excluded.add(field.id);
        continue;
      }
      if (field.hasValue || field.userEdited) {
        alreadyFilled++;
        continue;
      }
      field.module = fieldModule(field, repeat);
      if (isNeverGuessField(field)) { neverGuessCount++; continue; }
      // Someone else's details (家庭成员, 紧急联系人): never the applicant's, never AI.
      if (isThirdPartyField(field)) { thirdPartyCount++; continue; }
      // A read-only calendar box can't be typed into; say what to pick.
      if (field.readonlyPicker) {
        const suggestion = repeat ? repeatFieldValue(field, repeat, profile) : matchFlatField(field, profile);
        if (suggestion) field.suggestion = suggestion;
        pickOnPageCount++;
        continue;
      }
      const mapping = !repeat && (profile.mappings || []).find((m) => m.fieldKey === field.mappingKey);
      const mapped = mapping && profileChoices(profile).find((c) => c.ref === mapping.ref);
      if (mapped?.value) { pairs.push({ id: field.id, value: mapped.value, source: "profile", label: field.label, tag: field.tag, ref: mapped.ref }); continue; }
      // Saved 网申资料 rows are the source of truth for repeated blocks. A
      // remembered "学校" is one value and would otherwise fill every row.
      const structured = repeat ? repeatFieldValue(field, repeat, profile) : null;
      if (structured) {
        const row = repeat.record || (repeat.degreeHint ? educationRows(profile).find((item) => degreeLevel(item.degree) === repeat.degreeHint) : rowsForGroup(profile, repeat.group)[repeat.row]);
        pairs.push({ id: field.id, value: structured, source: "profile", label: field.label, tag: field.tag, ref: repeat.all && (repeat.summaryText || !rowsForGroup(profile, repeat.group).length) ? repeat.summaryRef || `summary:${repeat.group}` : row && !repeat.all ? `${recordReference(repeat.group, row)}:${repeat.kind}` : "", alternatives: repeat.group === "skill" && repeat.kind === "level" ? skillLevelAlternatives(structured) : degreeAlternatives(field, structured) });
        continue;
      }
      const rememberedValue = repeat && (repeat.group !== "education" || repeat.row > 0 || repeat.degreeHint || repeat.unmatched) ? null : matchRememberedField(field, profile.fieldMemories, pageContext);
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
      if (field.tag === "textarea" || field.tag === "richtext") {
        candidates.push({ id: field.id, label, kind: "essay" });
      } else if (field.tag === "select" || field.tag === "radio") {
        candidates.push({ id: field.id, label, kind: "choice", options: field.options || [] });
      } else {
        // custom-select options aren't known until opened — ask for a plain
        // value and let fillCustomSelects match it against what appears.
        candidates.push({ id: field.id, label, kind: "short" });
      }
    }
    // Fields sharing one module's saved entries are one entry being added.
    // Whatever would repeat a saved entry is left out, from 网申资料 now and
    // from the AI below; the AI is also told what is already there.
    const entryBlocks = new Map();
    for (const field of fields) {
      if (!field.savedEntries || repeats.has(field.id) || excluded.has(field.id)) continue;
      const key = JSON.stringify(field.savedEntries);
      if (!entryBlocks.has(key)) entryBlocks.set(key, { entries: field.savedEntries, ids: new Set() });
      entryBlocks.get(key).ids.add(field.id);
    }
    const repeatsSaved = new Map();
    const dropRepeatedEntries = (from) => {
      for (const block of entryBlocks.values()) {
        const items = pairs.slice(from).filter((pair) => block.ids.has(pair.id));
        if (!items.length || !repeatsSavedEntry(block.entries, items)) continue;
        for (const id of block.ids) repeatsSaved.set(id, block.entries.find((entry) => items.some((item) => savedEntryHas([entry], item.value))) || block.entries[0]);
      }
      for (let i = pairs.length - 1; i >= from; i--) if (repeatsSaved.has(pairs[i].id)) pairs.splice(i, 1);
      candidates = candidates.filter((question) => !repeatsSaved.has(question.id));
    };
    dropRepeatedEntries(0);
    candidates = candidates.map((question) => {
      const field = fields.find((f) => f.id === question.id);
      return field?.savedEntries && !repeats.has(field.id) ? { ...question, saved: field.savedEntries } : question;
    });
    const tooLong = new Set();
    function rejectOversize(from = 0) { for (let i = pairs.length - 1; i >= from; i--) { const field = fields.find((f) => f.id === pairs[i].id); if (options.mode !== "preview" && field?.maxLength && pairs[i].value.length > field.maxLength) { tooLong.add(field.id); pairs.splice(i, 1); } } }
    rejectOversize();
    const basicCount = pairs.length;
    if (!adapter.stillOnPage(initialUrl)) throw new Error("页面或标签已切换，已停止写入；请在当前页面重新填充");
    adapter.status({ phase: "scanning", message: `正在填写 ${basicCount} 个资料字段…` });
    const basicResult = options.mode === "preview" ? { filled: [], failed: [], skipped: [] } : await fillFrames(adapter, pairs, frameById, initialUrl);
    assertActive();
    const basicPairCount = pairs.length;
    const questionKeys = new Set((options.questionIds || []).map((id) => priorPlan?.fields.find((f) => f.id === id)?.mappingKey).filter(Boolean));
    if (questionKeys.size) {
      for (const field of fields) {
        if (questionKeys.has(field.mappingKey)) continue;
        const priorField = priorPlan.fields.find((f) => f.mappingKey === field.mappingKey);
        const priorPair = priorPlan.pairs.find((p) => p.id === priorField?.id);
        if (priorPair && !pairs.some((p) => p.id === field.id)) pairs.push({ ...priorPair, id: field.id });
      }
      candidates = candidates.filter((q) => questionKeys.has(fields.find((f) => f.id === q.id)?.mappingKey));
    }

    let aiError = null;
    if (candidates.length > 0 && !resumeVersionId) {
      aiError = "没选简历，这些字段跳过了";
    } else if (candidates.length > 0) {
      adapter.status({ phase: "ai", message: `已验证填入 ${basicResult.filled.length} 个资料字段，正在用 AI 生成 ${candidates.length} 个字段的内容…` });
      try {
        const answerRes = await adapter.api("answer-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questions: candidates.map((q) => ({ ...q, maxLength: fields.find((f) => f.id === q.id)?.maxLength || undefined })), resumeVersionId, profile, contextKey: pageContext, positionId: options.positionId, regenerate: options.regenerate, answerLength: options.answerLength }),
        });
        if (answerRes.ok) {
          const { answers } = await answerRes.json();
          const kindById = new Map(candidates.map((c) => [c.id, c.kind]));
          const seenAnswers = new Set();
          for (const a of Array.isArray(answers) ? answers : []) {
            if (!a || typeof a.answer !== "string" || !a.answer.trim()) continue;
            const kind = kindById.get(a.id);
            if (!kind || seenAnswers.has(a.id)) continue;
            const isSentinel = a.answer.trim().toUpperCase() === NEEDS_MANUAL_INPUT;
            if (isSentinel || /简历里没有相关信息|需要自己填/.test(a.answer)) continue;
            const field = fields.find((f) => f.id === a.id);
            if (!field || !kind) continue;
            seenAnswers.add(a.id);
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
    if (options.mode === "preview") {
      const choices = profileChoices(profile);
      const restored = await adapter.api(`application-draft?${new URLSearchParams({ contextKey: pageContext, url: initialUrl, resumeVersionId: resumeVersionId || "", variantId: options.variantId || "" })}`).then((r) => r.ok ? r.json() : null).catch(() => null);
      const plan = { id: adapter.taskId || String(Date.now()), url: initialUrl, at: Date.now(), fields, pairs, frameById, profile, options, resumeVersionId };
      const proposals = fields.map((field) => {
        const pair = pairs.find((p) => p.id === field.id);
        const eligible = !excluded.has(field.id) && !field.hasValue && !field.userEdited && !isNeverGuessField(field) && !isThirdPartyField(field) && !field.readonlyPicker;
        const oldField = priorPlan?.fields.find((f) => f.mappingKey === field.mappingKey);
        // A blank box the page auto-save captured is not an answer to restore;
        // only typed content or an edit made in this preview comes back.
        const stored = !priorPlan && restored?.content?.url === initialUrl && (restored.content?.resumeVersionId || "") === (resumeVersionId || "") && (restored.content?.variantId || "") === (options.variantId || "") && (Array.isArray(restored.content?.fields) ? restored.content.fields.find((f) => f && typeof f.value === "string" && f.fieldKey === field.mappingKey && (f.value.trim() || !f.captured || f.edited)) : null);
        const candidateEdit = options.previewEdits?.find((row) => row.id === oldField?.id);
        const sameContext = priorPlan?.url === initialUrl && priorPlan?.resumeVersionId === resumeVersionId && priorPlan?.options.variantId === options.variantId && priorPlan?.options.positionId === options.positionId;
        const edit = stored || (sameContext && !questionKeys.has(field.mappingKey) && (!options.regenerate || questionKeys.size || candidateEdit?.edited) && candidateEdit);
        return { ...(edit || {}), id: field.id, fieldKey: field.mappingKey, label: displayLabel(field), section: field.section, value: edit ? edit.value : pair?.value || "", selected: eligible && (edit ? edit.selected : !!pair && pair.source !== "ai"), eligible,
          source: pair?.source || "manual", ref: edit?.ref || pair?.ref || "", required: field.required, maxLength: field.maxLength,
          note: field.userEdited ? "手动修改过，保持不动" : field.hasValue ? "已有内容，保持不动" : excluded.has(field.id) ? "未选择此模块" : isThirdPartyField(field) ? "家庭成员 / 联系人等他人信息，请在网页上填写" : field.readonlyPicker ? `日期需在网页上点选${field.suggestion ? `：${field.suggestion}` : ""}` : !eligible ? "需在网页上手动填写" : stored?.captured ? "来自本次申请的网页草稿，请核对后选择填写" : pair?.source === "ai" ? "AI 草稿，请核对后勾选" : pair ? "来自已保存资料或回答" : (aiError || "请选择资料或输入内容") };
      });
      const result = { phase: "preview", message: "填写建议已准备好，勾选并核对后再写入；网页内容尚未改动", plan: { id: plan.id, url: initialUrl, proposals, choices, blocks: previewRecordBlocks(blocks, repeats, profile), resumeVersionId, positionId: options.positionId, uploadResume: modules.has("resume") && !!resumeVersionId, contextKey: pageContext, variantId: options.variantId } };
      plan.preview = result.plan; await adapter.setPlan(plan);
      adapter.status(result); return result;
    }
    dropRepeatedEntries(basicPairCount);
    rejectOversize(basicPairCount);
    const aiResult = await fillFrames(adapter, pairs.slice(basicPairCount), frameById, initialUrl);
    if (!adapter.stillOnPage(initialUrl)) throw new Error("页面或标签已切换，已停止写入；请在当前页面重新填充");
    const filled = [...basicResult.filled, ...aiResult.filled];
    const failed = [...basicResult.failed, ...aiResult.failed];
    const skipped = [...basicResult.skipped, ...aiResult.skipped];
    const filledSet = new Set(filled);
    const rememberedDrafts = pairs.filter((p) => p.source !== "profile" && p.source !== "remembered-field" && p.answerId && filledSet.has(p.id) && isOpenEndedQuestionField(fields.find((f) => f.id === p.id) || p))
      .map((p) => ({ id: p.id, answerId: p.answerId, label: p.label, filledValue: p.value }));
    const newIds = new Set(rememberedDrafts.map((draft) => draft.answerId));
    adapter.setDrafts([...adapter.getDrafts().filter((draft) => !newIds.has(draft.answerId)), ...rememberedDrafts]);
    const basicFilled = pairs.filter((p) => (p.source === "profile" || p.source === "remembered-field") && filledSet.has(p.id)).length;
    const isEssay = (p) => p.tag === "textarea" || p.tag === "richtext";
    const essayFilled = pairs.filter((p) => isEssay(p) && p.source !== "profile" && p.source !== "remembered-field" && filledSet.has(p.id)).length;
    const shortFilled = filled.length - basicFilled - essayFilled;
    const rememberedFilled = pairs.filter((p) => isEssay(p) && p.source !== "remembered-field" && p.remembered && filledSet.has(p.id)).length;
    const essayReused = pairs.filter((p) => isEssay(p) && p.reused && filledSet.has(p.id)).length;
    const aiReused = essayReused - rememberedFilled;
    const failedSet = new Set(failed);
    const skippedSet = new Set(skipped);
    // An empty form below saved cards with no record left for it.
    const allSavedOnPage = (field) => {
      const repeat = repeats.get(field.id);
      return !!repeat && !field.hasValue && !filledSet.has(field.id) && !!rowIndexes.get(`${repeat.group}:saved`) && repeat.row >= rowsForGroup(profile, repeat.group).length;
    };
    const details = fields.map((field) => excluded.has(field.id)
      ? { label: field.section ? `${field.section} · ${displayLabel(field)}` : displayLabel(field), id: field.id, state: "未勾选此模块，已跳过", source: "excluded" }
      : skippedSet.has(field.id)
      ? { label: displayLabel(field), state: "填写期间已有修改，已保留", source: "prefilled" }
      : repeatsSaved.has(field.id) && !field.hasValue && !filledSet.has(field.id)
      ? { label: displayLabel(field), id: field.id, state: `上面已保存过「${repeatsSaved.get(field.id).slice(0, 30)}」，这一组没重复填`, source: "prefilled" }
      : { ...fillDetail(field, pairs.find((p) => p.id === field.id), filledSet, failedSet), id: field.id, ...(allSavedOnPage(field) ? { state: "这类经历已全部保存在页面上，这一组不用再填", source: "prefilled" } : {}) });
    const previous = options.accumulated || { filled: 0, uploaded: 0, details: [] };
    const earlier = new Map(previous.details.map((d) => [d.key, d]));
    const merged = new Map(earlier);
    let priorFillsOnPage = 0;
    details.forEach((detail, index) => {
      const field = fields[index];
      const key = field.resultKey || field.id;
      const prior = earlier.get(key);
      const wasFilled = prior && ["profile", "memory", "ai"].includes(prior.source);
      if (detail.source === "prefilled" && wasFilled) {
        priorFillsOnPage++;
        merged.set(key, prior);
      } else merged.set(key, { ...detail, key });
    });
    const validation = [...await validateFrames(adapter, frameById), ...[...tooLong].map((id) => ({ id, message: "内容超过网页字数上限，已跳过，请缩短后填写" }))];
    for (const issue of validation) { const field = fields.find((f) => f.id === issue.id); if (field) merged.set(field.resultKey || field.id, { id: field.id, label: field.label || field.placeholder || field.name, state: issue.message, source: "manual" }); }
    const allDetails = [...merged.values()];
    let uploadedResumeCount = 0;
    let uploadError = null;
    if (resumeVersionId && modules.has("resume")) {
      try {
        if (!adapter.stillOnPage(initialUrl)) throw new Error("页面已切换，已停止上传简历");
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
    const savedCards = ["education", "experience", "project", "award", "campus"].reduce((sum, group) => sum + (rowIndexes.get(`${group}:saved`) || 0), 0);
    if (savedCards > 0) parts.push(`页面上已保存的 ${savedCards} 段经历没有重复填，空白的一组接着填了下一段`);
    const repeatedEmpty = fields.filter((field) => repeatsSaved.has(field.id) && !field.hasValue && !field.userEdited).length;
    if (repeatedEmpty > 0) parts.push(`${repeatedEmpty} 个字段要填的内容上面已保存过，没重复填；还有别的要加就手填这一组`);
    if (uploadedResumeCount > 0) parts.push(`已上传简历附件到 ${uploadedResumeCount} 个位置`);
    if (uploadError) parts.push(uploadError);
    // After an 添加 round the earlier rounds' own fills count as "已有内容".
    if (alreadyFilled > 0 && !options.round) parts.push(`${alreadyFilled} 个已有内容的字段没动`);
    if (skipped.length > 0) parts.push(`${skipped.length} 个填写期间已有修改的字段已保留`);
    if (excluded.size > 0) parts.push(`${excluded.size} 个不在填写范围内的字段已跳过`);
    if (failed.length > 0) {
      parts.push(`${failed.length} 个字段未通过写入验证（${failed.slice(0, 3).join("、")}${failed.length > 3 ? "…" : ""}），需要手填`);
    }
    if (neverGuessCount > 0) parts.push(`${neverGuessCount} 个需核对的姓名拆分或敏感字段，没有自动填`);
    if (thirdPartyCount > 0) parts.push(`${thirdPartyCount} 个家庭成员 / 联系人等他人信息字段留给你填`);
    if (pickOnPageCount > 0) parts.push(`${pickOnPageCount} 个日期只能在网页上点选`);
    const attempted = repeatedEmpty + filled.length + neverGuessCount + thirdPartyCount + pickOnPageCount + alreadyFilled + failed.length + skipped.length;
    const stillManual = fields.length - excluded.size - attempted;
    if (stillManual > 0) {
      parts.push(aiError ? `${stillManual} 个字段没能自动填（${aiError}）` : `${stillManual} 个字段简历里没有对应信息，需要自己填`);
    }
    const added = options.added || [];
    const missing = missingRepeatCounts(profile, rowIndexes).filter(({ group }) => modules.has(group));
    const round = options.round || 0;
    if (options.expandBlocks && missing.length && round < 4 && !options.modal && adapter.stillOnPage(initialUrl)) {
      const clicked = [];
      let modal = false;
      for (const { group, label } of missing) {
        for (const frame of await adapter.frames()) {
          assertActive();
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
        return runAutofillCore(adapter, resumeVersionId, { ...options, round: round + 1, modal, added: [...added, ...clicked], accumulated: { filled: previous.filled + filled.length, uploaded: previous.uploaded + uploadedResumeCount, details: allDetails } });
      }
    }
    if (added.length) {
      const counts = added.reduce((map, label) => map.set(label, (map.get(label) || 0) + 1), new Map());
      parts.unshift(`已自动添加 ${[...counts].map(([label, n]) => `${n} 组${label}`).join("、")}`);
      if (options.modal) parts.push("新栏目在弹窗里：核对后点弹窗的保存，再点一次一键填写继续下一段");
    }
    const missingBlocks = missing.map(({ saved, shown, label }) => `有 ${saved} 段${label}、页面只有 ${shown} 组`);
    if (missingBlocks.length) {
      parts.push(options.expandBlocks
        ? `网申资料里${missingBlocks.join("、")}，没找到能自动点的「添加」按钮——请手动添加后再点一次一键填写`
        : `网申资料里${missingBlocks.join("、")}，但这页的对应栏目不够——先点页面上的「添加」再点一次一键填写，或勾选「自动补齐栏目」`);
    }
    parts.push("你手填的内容：网申资料里还空着的会直接记进去（可撤销），其余的先放进待核对；提交前请核对所有填入内容");

    assertActive();
    const summary = { filled: previous.filled + filled.length, manual: allDetails.filter((d) => d.source === "manual").length, preserved: Math.max(0, alreadyFilled - priorFillsOnPage) + skipped.length, excluded: allDetails.filter((d) => d.source === "excluded").length, uploaded: previous.uploaded + uploadedResumeCount };
    if (round) parts.unshift(`本次累计填入 ${summary.filled} 个字段、上传 ${summary.uploaded} 个附件；以下为最后一轮说明`);
    const result = { phase: "done", message: parts.join("；"), details: allDetails, summary };
    adapter.status(result);
    return result;
  } catch (err) {
    const result = { phase: "error", message: adapter.stopReason?.() || (err && err.message ? err.message : "自动填充失败") };
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
async function saveCorrectionsCore(adapter, resumeVersionId, onlyUserEdited = false, variantId, discover = true) {
  const pageUrl = adapter.url();
  const filledList = adapter.getDrafts();
  const answers = [];
  const records = [];
  const withdrawals = [];
  const savedFields = [];
  const emptyEdits = [];
  // Record boxes the applicant typed (not the ones 一键填写 filled from 网申资料).
  let recordsTyped = 0;
  // A fresh scan also includes answers the user wrote entirely by hand.
  // Read the original AI ids first; scanning replaces the temporary DOM ids.
  const { fields, frameById } = await scanFrames(adapter);
  const rowIndexes = new Map();
  const snapshots = {};
  // One IPC/script call per frame, rather than one per field.
  for (const frame of new Set(frameById.values())) {
    const ids = fields.filter((field) => frameById.get(field.id) === frame).map((field) => field.id);
    Object.assign(snapshots, await adapter.run(frame, readFieldValues, [ids]).catch(() => ({})));
  }
  const groups = new Map();
  for (const field of fields) {
    const repeat = resolveRepeatField(field, rowIndexes);
    const label = field.label || field.placeholder || field.name;
    if (!label || isForbiddenMemoryField(field)) continue;
    const frame = frameById.get(field.id);
    if (frame === undefined) continue;
    const snapshot = snapshots[field.id] || {};
    if (snapshot.userEdited && snapshot.memorySaved !== "" && !String(snapshot.value || "").trim() && !snapshot.active && Date.now() - snapshot.editedAt >= 2500) {
      emptyEdits.push({ frame, id: field.id, value: "" });
      if (!repeat && field.mappingKey) withdrawals.push({ kind: "answer", fieldKey: field.mappingKey });
    }
    if (repeat) {
      // Structured descriptions never enter the generic essay library.
      const key = `${field.id.split("-")[0]}:${repeat.blockKey}`;
      if (!groups.has(key)) groups.set(key, { category: repeat.group, captureKey: repeat.blockKey, fields: [] });
      groups.get(key).fields.push({ field, info: repeat, snapshot, frame });
      continue;
    }
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
    const key = openEnded ? label : fieldMemoryKey(field);
    if (!key) continue;
    // Typed by the applicant (not a default the page showed): may fill a blank in 网申资料.
    const profileKey = snapshot.userEdited ? learnableProfileKey(field) : null;
    answers.push({ questionLabel: key, fieldKey: field.mappingKey, answer: candidate.value, answerId: openEnded ? candidate.answerId : undefined, kind: openEnded ? field.tag === "textarea" || field.tag === "richtext" ? "essay" : "short" : "field", ...(profileKey ? { profileKey } : {}) });
    savedFields.push({ frame, id: field.id, value: candidate.value });
  }
  for (const group of groups.values()) {
    const content = {}, members = [];
    let edited = 0;
    const captureKey = group.fields[0].field.mappingKey ? `field:${stableMemoryHash(group.fields[0].field.mappingKey)}` : group.captureKey;
    const candidates = group.fields.filter(({ snapshot }) => memoryCandidate(snapshot, filledList, onlyUserEdited) && (!snapshot.answerId || snapshot.userEdited));
    const cleared = group.fields.some(({ snapshot }) => snapshot.userEdited && snapshot.memorySaved !== "" && !String(snapshot.value || "").trim() && Date.now() - snapshot.editedAt >= 2500);
    if ((!candidates.length && !cleared) || (onlyUserEdited && group.fields.some(({ snapshot }) => snapshot.active || (snapshot.userEdited && Date.now() - snapshot.editedAt < 2500)))) continue;
    // A portal may expose the whole module as one textarea. Preserve its
    // original text, without interpreting it as a project name or an essay.
    if (group.fields.length === 1 && group.fields[0].info.kind === "summary") {
      if (!candidates.length) { withdrawals.push({ kind: "record", category: group.category, captureKey }); continue; }
      const { field, snapshot, frame } = candidates[0];
      const candidate = memoryCandidate(snapshot, filledList, onlyUserEdited);
      if (candidate.value.length >= 2 && candidate.value.length <= 10000) {
        records.push({ category: group.category, content: { text: candidate.value }, captureKey });
        if (snapshot.userEdited) recordsTyped++;
        savedFields.push({ frame, id: field.id, value: candidate.value });
      }
      continue;
    }
    for (const { field, info, snapshot, frame } of group.fields) {
      const value = String(snapshot.value || "").trim();
      if (!value || value.length > 10000 || (snapshot.answerId && !snapshot.userEdited) || ["summary"].includes(info.kind)) continue;
      if (info.kind === "range") {
        const dates = value.match(/\d{4}(?:[-./年]\d{1,2}(?:月)?(?:[-./月]\d{1,2}(?:日)?)?)?|至今|现在|present/gi);
        if (dates?.length === 2) { content.start = dates[0]; content.end = dates[1]; }
      } else if (!content[info.kind]) content[info.kind] = value;
      else if (content[info.kind] !== value) continue;
      members.push({ frame, id: field.id, value });
      if (snapshot.userEdited) edited++;
    }
    // "IELTS 6.5" typed into a box named after the exam: the exam is the row's name.
    if (group.category === "language" && !content.name) {
      const exam = group.fields.map(({ info }) => info.exam).find(Boolean);
      if (exam && EXAM_NAMES[exam]) content.name = EXAM_NAMES[exam];
    }
    const anchor = group.category === "education" ? "school" : group.category === "experience" ? "company" : "name";
    if (!content[anchor] || !Object.entries(content).some(([key, value]) => key !== anchor && value)) {
      withdrawals.push({ kind: "record", category: group.category, captureKey });
      savedFields.push(...members);
      // A lone basic education field remains useful even when this page has
      // no complete education block. Other experiences need their name.
      if (group.category === "education") for (const { field, info, snapshot, frame } of candidates) {
        const candidate = memoryCandidate(snapshot, filledList, onlyUserEdited);
        const key = fieldMemoryKey(field);
        if (candidate && snapshot.userEdited && info.row === 0 && !info.degreeHint && ["学校", "专业", "学历"].includes(key)) { answers.push({ questionLabel: key, fieldKey: field.mappingKey, answer: candidate.value, kind: "field" }); savedFields.push({ frame, id: field.id, value: candidate.value }); }
      }
      continue;
    }
    records.push({ category: group.category, content, captureKey });
    recordsTyped += edited;
    savedFields.push(...members);
  }
  if (adapter.url() !== pageUrl || adapter.stillOnPage?.(pageUrl) === false) return { saved: 0 };
  const contextKey = adapter.jobId?.() ? `job:v1:${adapter.jobId()}` : portalContext(pageUrl);
  const draft = { contextKey, url: pageUrl, positionId: adapter.jobId?.(), resumeVersionId, variantId,
    fields: fields.filter((field) => !isForbiddenMemoryField(field) && snapshots[field.id] && String(snapshots[field.id].value || "").length <= 20000).map((field) => ({ label: field.label || field.placeholder || field.name || "字段", fieldKey: field.mappingKey, section: field.section, value: String(snapshots[field.id].value || ""), selected: false, remember: false, edited: !!snapshots[field.id].userEdited, captured: true })) };
  const signature = JSON.stringify(draft);
  // Boxes the applicant typed in that 一键填写 left to them (essays are theirs to write anyway).
  const handTyped = discover ? answers.filter((answer) => answer.kind === "field").length + recordsTyped : 0;
  if (!discover) { answers.length = 0; records.length = 0; withdrawals.length = 0; savedFields.length = 0; emptyEdits.length = 0; }
  if (!answers.length && !records.length && !withdrawals.length && (!draft.fields.length || adapter.getDraftSignature?.() === signature)) return { saved: 0, draftSaved: draft.fields.length > 0 && adapter.getDraftSignature?.() === signature };
  savedFields.push(...emptyEdits);

  const res = await adapter.api("save-corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "stage", resumeVersionId, variantId, sourceUrl: pageUrl, contextKey, draft, answers, records, withdrawals }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "保存回答失败");
  const body = await res.json();
  if (body.draftSaved) adapter.setDraftSignature?.(signature);
  if (discover && (body.processed ?? body.saved) === answers.length + records.length) {
    for (const frame of new Set(savedFields.map((field) => field.frame))) {
      const entries = savedFields.filter((field) => field.frame === frame).map(({ id, value }) => ({ id, value }));
      await adapter.run(frame, clearSavedUserEdits, [entries]).catch(() => {});
    }
    // Staging is not confirmation. Retain AI draft provenance so a later
    // capture cannot mistake an untouched generated value for a user answer.
  }
  return { handTyped, saved: body.saved ?? 0, pending: body.pending ?? 0, pendingTotal: body.pendingTotal, draftSaved: body.draftSaved, unchanged: body.unchanged ?? 0, learned: Array.isArray(body.learned) ? body.learned : [] };
}

// Values are referenced from the saved profile, never reconstructed by the model.
function profileChoices(profile) {
  const choices = [];
  const labels = { name: "姓名", phone: "手机", email: "邮箱", gender: "性别", birthDate: "出生日期", currentCity: "现居地", country: "所在国家 / 地区", englishName: "英文名", exchange: "交换 / 海外经历", targetRole: "期望岗位", selfIntro: "自我评价", politics: "政治面貌", hometown: "籍贯", ethnicity: "民族", english: "英语水平", wechat: "微信号", qq: "QQ 号", expectedSalary: "期望薪资", availableFrom: "最早到岗时间", internshipDuration: "可实习时长", address: "通讯地址", researchDirection: "研究方向", rank: "成绩排名", acceptAdjust: "是否接受调剂", courses: "主修课程", homepage: "个人主页 / 作品链接", lab: "实验室 / 课题组", hobbies: "兴趣爱好", thesis: "毕业论文" };
  for (const [ref, label] of Object.entries(labels)) if (profile[ref]) choices.push({ ref, label, value: String(profile[ref]) });
  const columns = { school: "学校", major: "专业", department: "院系 / 部门", degree: "学历", gpa: "GPA", start: "开始时间", end: "结束时间", company: "公司", role: "角色/职位", name: "名称", description: "描述", responsibilities: "职责", link: "项目链接", issuer: "颁发单位", level: "等级 / 程度", category: "类别", date: "日期", language: "语种", score: "分数" };
  for (const [group, label] of [["education", "教育"], ["experience", "工作/实习"], ["project", "项目"], ["award", "获奖"], ["campus", "校园经历"], ["skill", "技能"], ["language", "语言"]]) {
    rowsForGroup(profile, group, true).forEach((row, index) => { for (const [key, text] of Object.entries(columns)) if (row[key]) choices.push({ ref: `${recordReference(group, row)}:${key}`, label: `${label} ${index + 1}（${row.school || row.company || row.name || row.degree || ""}）${row.__memoryLabel ? ` · ${row.__memoryLabel}` : ""} · ${text}`, value: String(row[key]) }); });
    const text = (profile.library || []).find((entry) => entry.category === group && entry.content.text)?.content.text || profile.summaries?.[group];
    if (text) choices.push({ ref: `summary:${group}`, label: `${label} · 整段原文`, value: String(text) });
    for (const entry of profile.library || []) {
      if (entry.category !== group || !entry.content.text) continue;
      for (const [index, content] of [entry.content, ...(entry.alternatives || []).map((item) => item.content)].entries()) {
        if (!content.text) continue;
        choices.push({ ref: `summary:${group}:memory:${entry.id}:${stableMemoryHash(content.text)}`, label: `${label} · 整段原文 · ${index ? `其他版本 ${index}` : "资料库默认版"}`, value: String(content.text) });
      }
    }
  }
  return choices;
}

function focusFormField(id) {
  const roots = [document];
  for (let i = 0; i < roots.length; i++) Array.from(roots[i].querySelectorAll ? roots[i].querySelectorAll("*") : []).forEach((node) => { if (node.shadowRoot) roots.push(node.shadowRoot); });
  const selector = '[data-cp-fill-id="' + CSS.escape(id) + '"], [data-cp-fill-id^="' + CSS.escape(id) + ':"]';
  let el = null;
  for (const root of roots) { el = root.querySelector(selector); if (el) break; }
  if (!el) return false;
  // A radio pill or hidden native input is shown by its label.
  const target = el.type === "radio" && el.closest("label") ? el.closest("label") : el;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  el.focus({ preventScroll: true });
  target.style.outline = "3px solid #f59e0b";
  return true;
}

function validatePageFields() {
  const issues = [];
  const roots = [document];
  for (let i = 0; i < roots.length; i++) Array.from(roots[i].querySelectorAll ? roots[i].querySelectorAll("*") : []).forEach((node) => { if (node.shadowRoot) roots.push(node.shadowRoot); });
  for (const el of roots.flatMap((root) => Array.from(root.querySelectorAll("[data-cp-fill-id]")))) {
    if (el.disabled || el.readOnly || !el.getBoundingClientRect().width) continue;
    const id = el.getAttribute("data-cp-fill-id");
    const row = el.closest(".ant-form-item, .el-form-item, .form-group, [class*='form-item']");
    const message = row?.querySelector(".ant-form-item-explain-error, .el-form-item__error, [role='alert']")?.textContent?.trim();
    if (message || el.getAttribute("aria-invalid") === "true") issues.push({ id, message: `网页提示：${message || "内容未通过校验"}` });
    else if (el.validity && !el.validity.valid) issues.push({ id, message: el.validity.valueMissing ? "必填项尚未填写" : `格式需核对：${el.validationMessage || "网页校验未通过"}` });
  }
  return issues;
}

async function validateFrames(adapter, frameById) {
  const issues = [];
  for (const frame of new Set(frameById.values())) issues.push(...((await adapter.run(frame, validatePageFields, []).catch(() => [])) || []));
  return issues;
}

// Explicitly captured only when the user records a submitted application.
function readCurrentApplicationFields() {
  // A named function can register itself without eval. MV3's isolated world
  // disallows constructing functions from strings, even for our own code.
  window.__cpReadApplicationFields = readCurrentApplicationFields;
  const fields = [];
  const seen = new Set();
  const roots = [document];
  for (let i = 0; i < roots.length; i++) Array.from(roots[i].querySelectorAll ? roots[i].querySelectorAll("*") : []).forEach((node) => { if (node.shadowRoot) roots.push(node.shadowRoot); });
  for (const el of roots.flatMap((root) => Array.from(root.querySelectorAll("[data-cp-fill-id]")))) {
    if (el.type === "password") continue;
    const fillId = el.getAttribute("data-cp-fill-id");
    const radios = el.type === "radio" ? roots.flatMap((root) => Array.from(root.querySelectorAll('[data-cp-fill-id^="' + fillId.split(":")[0] + ':"]'))) : null;
    // One entry per radio group, read from its first (labelled) member.
    if (radios && radios[0] !== el) continue;
    if (!(radios ? radios.some((r) => (r.closest("label") || r).getBoundingClientRect().width) : el.getBoundingClientRect().width)) continue;
    const label = el.getAttribute("data-cp-fill-label") || el.getAttribute("aria-label") || (el.id && el.getRootNode().querySelector('label[for="' + CSS.escape(el.id) + '"]')?.textContent) || el.closest(".ant-form-item, .el-form-item, .form-group")?.querySelector("label, [class*='label']")?.textContent || el.name || el.placeholder || "字段";
    if (/密码|验证码|证件|身份证|银行卡|护照|家庭住址|password|captcha|passport|social security|bank account/i.test(label)) continue;
    let value = el.value || el.querySelector?.(".ant-select-selection-item, .ud__select__selector__selectItem, .el-select__selected-item:not(.el-select__input-wrapper)")?.textContent || "";
    if (radios) {
      const checked = radios.find((r) => r.checked);
      value = checked?.closest("label")?.textContent || checked?.value || "";
    } else if (el.tagName === "SELECT") value = el.options[el.selectedIndex]?.textContent || "";
    else if (el.getAttribute("role") === "radiogroup") value = el.querySelector("[role='radio'][aria-checked='true']")?.textContent || "";
    else if (el.isContentEditable && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") value = el.innerText || "";
    value = String(value).trim();
    if (!value || fields.length >= 250 || /\d{17}[\dXx]/.test(value)) continue;
    const key = `${label}:${value}`;
    if (!seen.has(key)) fields.push({ label: String(label).trim().slice(0, 200), value: value.slice(0, 20000) });
    seen.add(key);
  }
  return fields;
}

// Cache only values already present on the visited page, for the success screen.
function watchApplicationFields(contextKey) {
  if (window.__cpArchiveContextKey !== contextKey) { try { sessionStorage.removeItem("cp-submission-fields"); } catch {} }
  window.__cpArchiveContextKey = contextKey;
  if (window.__cpArchiveWatch) return true;
  const collect = window.__cpReadApplicationFields;
  if (typeof collect !== "function") return false;
  const capture = () => { try { const fields = collect(); if (fields.length) sessionStorage.setItem("cp-submission-fields", JSON.stringify({ at: Date.now(), url: location.href, fields, contextKey: window.__cpArchiveContextKey })); } catch { /* Storage can be disabled by the site. */ } };
  window.__cpArchiveWatch = true;
  document.addEventListener("submit", capture, true);
  document.addEventListener("click", (event) => { if (event.target.closest?.("button, input[type='submit'], [role='button']")) capture(); }, true);
  window.addEventListener("beforeunload", capture);
  return true;
}
function collectApplicationFields(contextKey) {
  const current = typeof window.__cpReadApplicationFields === "function" ? window.__cpReadApplicationFields() : [];
  if (current.length) return current;
  try { const stored = JSON.parse(sessionStorage.getItem("cp-submission-fields") || "null"); if (stored && stored.contextKey === contextKey && Date.now() - stored.at < 3600000 && Array.isArray(stored.fields)) return stored.fields.slice(0, 250); } catch { /* No readable previous step. */ }
  return [];
}

async function applyAutofillPlan(adapter, input) {
  const plan = adapter.getPlan();
  try {
    if (!plan || plan.id !== input.planId || Date.now() - plan.at > 10 * 60000 || !adapter.stillOnPage(plan.url)) throw new Error("预览已过期或页面已变化，请重新扫描");
    const choices = profileChoices(plan.profile);
    const live = await scanFrames(adapter);
    const liveByOldId = new Map(plan.fields.map((f) => [f.id, live.fields.find((current) => f.resultKey ? current.resultKey === f.resultKey : current.id === f.id || current.mappingKey === f.mappingKey)]));
    const pairs = [];
    const selected = new Set();
    for (const row of (input.approved || []).slice(0, 500)) {
      const field = plan.fields.find((f) => f.id === row.id);
      if (!field || field.hasValue || isNeverGuessField(field) || isThirdPartyField(field) || field.readonlyPicker || selected.has(row.id)) continue;
      const current = liveByOldId.get(row.id);
      if (!current) throw new Error("网页表单已变化，请重新扫描预览");
      if (current.hasValue || current.userEdited) { selected.add(row.id); continue; }
      const original = plan.pairs.find((p) => p.id === row.id);
      const choice = row.ref && choices.find((c) => c.ref === row.ref);
      // A reference selects a source; editing the suggested text afterwards
      // must not be discarded when the user clicks Confirm.
      const value = String(row.value || "").trim();
      if (!value || value.length > 20000) continue;
      if (field.maxLength && value.length > field.maxLength) throw new Error(`「${field.label || field.name}」超过 ${field.maxLength} 字，请缩短后再填`);
      if (!plan.options.modules?.includes((field.module || fieldModule(field))) && plan.options.modules) continue;
      pairs.push({ ...original, id: current.id, label: field.label, tag: field.tag, value, manualConfirmed: !choice && value !== original?.value, source: choice || value !== original?.value ? "profile" : original?.source || "profile" });
      selected.add(row.id);
    }
    if (!pairs.length && !selected.size && !(input.uploadResume && plan.resumeVersionId)) throw new Error("请至少勾选一个有内容的字段或简历附件");
    const result = await fillFrames(adapter, pairs, live.frameById, plan.url);
    const issues = await validateFrames(adapter, live.frameById);
    const filledSet = new Set(result.filled);
    adapter.setDrafts([...adapter.getDrafts(), ...pairs.filter((p) => filledSet.has(p.id) && p.answerId && p.value === plan.pairs.find((o) => liveByOldId.get(o.id)?.id === p.id)?.value).map((p) => ({ id: p.id, answerId: p.answerId, label: p.label, filledValue: p.value }))]);
    // Store reference mappings only for fields that actually accepted the chosen value.
    const mappings = (input.approved || []).filter((row) => row.remember && row.ref && filledSet.has(liveByOldId.get(row.id)?.id)).map((row) => ({ fieldKey: plan.fields.find((f) => f.id === row.id).mappingKey, ref: row.ref }));
    if (mappings.length) await adapter.api("field-mapping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contextKey: plan.options.positionId ? `job:v1:${plan.options.positionId}` : portalContext(plan.url), mappings }) }).then((r) => { if (!r.ok) throw new Error("填写已完成，但字段对应关系保存失败"); });
    let uploaded = 0;
    if (input.uploadResume && plan.resumeVersionId && adapter.stillOnPage(plan.url)) uploaded = await adapter.uploadResume(plan.resumeVersionId);
    const details = plan.fields.map((field) => {
      const current = liveByOldId.get(field.id) || field;
      const issue = issues.find((i) => i.id === current.id);
      return { id: current.id, label: field.section ? `${field.section} · ${field.label || field.name}` : field.label || field.name || "字段", source: issue || result.failed.includes(current.id) ? "manual" : filledSet.has(current.id) ? "profile" : current.hasValue || current.userEdited || result.skipped.includes(current.id) ? "prefilled" : "excluded", state: issue?.message || (filledSet.has(current.id) ? "已写入；提交前核对网页" : result.failed.includes(current.id) ? "写入未通过，需要手填" : current.hasValue || current.userEdited || result.skipped.includes(current.id) ? "已有或手改内容，已保留" : "本次未选择") };
    });
    const status = { phase: "done", message: `已写入 ${result.filled.length} 项，网页校验发现 ${issues.length} 项需处理；未替你保存或提交`, details, summary: { filled: result.filled.length, manual: details.filter((d) => d.source === "manual").length, preserved: details.filter((d) => d.source === "prefilled").length, excluded: details.filter((d) => d.source === "excluded").length, uploaded } };
    await adapter.setPlan(null); if (adapter.onFilled) await adapter.onFilled(); adapter.status(status); return status;
  } catch (error) { const valid = plan && plan.id === input.planId && Date.now() - plan.at <= 10 * 60000 && adapter.stillOnPage(plan.url); const status = { phase: "error", message: error.message || "填写失败", ...(valid && plan.preview ? { plan: plan.preview } : {}) }; if (!valid) await adapter.setPlan(null); adapter.status(status); return status; }
}

module.exports = {
  isThirdPartyField, displayLabel, basicRuleMatches, normalizePhone, englishValue, matchPhoneChoice,
  classifyRepeatBlocks, savedRecordsOnPage, repeatsSavedEntry, previewRecordBlocks, formSkeleton, rowsForGroup, recordReference, awardFieldKind,
  profileChoices, applyAutofillPlan, validatePageFields, focusFormField, collectApplicationFields, readCurrentApplicationFields, watchApplicationFields,
  AUTOFILL_MODULES,
  fieldModule,
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
  ageFromBirthDate,
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
  learnableProfileKey,
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
  skillFieldKind,
  countryFromCity,
  placeForField,
  languageFieldKind,
  languageRows,
  examKey,
  skillLevelAlternatives,
  skillLevelOption,
  snapshotFormStructure,
  trackUserEdits,
};
