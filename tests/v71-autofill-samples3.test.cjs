const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAutofillCore() {
  const source = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    Date,
    Math,
    URL,
    URLSearchParams,
    Set,
    Map,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    JSON,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}\nmodule.exports.__test = { scanPageFields, applyAutofillPlan, fillCustomSelects, resolveRepeatField, repeatFieldValue, repeatFieldGoesToAi, customValueAlternatives };`,
    context
  );
  return context.module.exports.__test;
}

test("v71: experience jobType, project responsibilities fallback/AI, and studyForm/yesNo alternatives", () => {
  const core = loadAutofillCore();
  const expRow = new Map();
  const jobTypeField = { id: "s1", tag: "custom-select", type: "", label: "岗位类型", placeholder: "请选择", name: "", section: "实习经历添加", options: null };
  const jobTypeInfo = core.resolveRepeatField(jobTypeField, expRow);
  assert.equal(jobTypeInfo.group, "experience");
  assert.equal(jobTypeInfo.kind, "jobType");
  const prof = {
    experiences: [{ company: "测试科技", role: "算法实习生", start: "2025-06", end: "2025-09", description: "模型优化" }],
    projects: [{ name: "推荐系统", role: "负责人", start: "2024-09", end: "2025-01", description: "负责排序模型训练与线上AB测试", responsibilities: "" }],
    educations: [{ school: "英国剑桥大学", degree: "硕士", major: "计算机", start: "2024-09", end: "2025-09", gpa: "" }],
  };
  assert.equal(core.repeatFieldValue(jobTypeField, jobTypeInfo, prof), "实习");

  const projResp = core.resolveRepeatField({ id: "t1", tag: "textarea", label: "项目中职责", placeholder: "", name: "", section: "项目经历" }, new Map());
  assert.equal(projResp.kind, "responsibilities");
  assert.equal(core.repeatFieldGoesToAi(projResp, prof), true);
  assert.equal(core.repeatFieldValue({ label: "项目中职责" }, { ...projResp, fallbackDescription: true }, prof), "负责排序模型训练与线上AB测试");

  const modeAlts = core.customValueAlternatives("海外留学生", "mode");
  assert.ok(modeAlts.includes("海外留学") && modeAlts.includes("全日制") && modeAlts.includes("统招全日制"));
  const tierAlts = core.customValueAlternatives("海外院校");
  assert.ok(tierAlts.includes("国外院校") && tierAlts.includes("境外院校"));
  const ynAlts = core.customValueAlternatives("是");
  assert.ok(ynAlts.includes("有") && ynAlts.includes("Yes"));
});

test("v71: scanPageFields ignores validation message text '必填项未填写' / '至' and detects Wind *-area-info dropdowns", () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");
  const makeNode = (props) => {
    const attrs = new Map(Object.entries(props.attrs || {}));
    const el = {
      tagName: (props.tagName || "DIV").toUpperCase(),
      type: props.type || "",
      id: props.id || "",
      className: props.className || "",
      classList: { contains: (c) => (props.className || "").split(/\s+/).includes(c) },
      textContent: props.textContent || "",
      innerText: props.textContent || "",
      value: props.value || "",
      readOnly: !!props.readOnly,
      disabled: !!props.disabled,
      parentElement: null,
      children: [],
      previousElementSibling: null,
      nextElementSibling: null,
      nextSibling: null,
      shadowRoot: null,
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      hasAttribute: (k) => attrs.has(k),
      removeAttribute: (k) => attrs.delete(k),
      matches: (sel) => sel.split(",").some((part) => {
        const s = part.trim();
        if (s === "input" || s === "INPUT") return el.tagName === "INPUT";
        if (s.includes("input[type=\"text\"]")) return el.tagName === "INPUT" && el.type === "text";
        if (s.includes("sd-Select-container")) return /sd-Select-container/.test(el.className);
        if (s.includes("label")) return el.tagName === "LABEL" || /label/.test(el.className);
        return false;
      }),
      contains: (target) => {
        for (let cur = target; cur; cur = cur.parentElement) if (cur === el) return true;
        return false;
      },
      closest: (sel) => {
        for (let cur = el; cur; cur = cur.parentElement) {
          if (sel.split(",").some((p) => {
            const k = p.trim();
            if (k.startsWith(".")) return (cur.className || "").split(/\s+/).includes(k.slice(1));
            if (k.includes("sd-Select-container")) return /sd-Select-container/.test(cur.className);
            return cur.tagName.toLowerCase() === k;
          })) return cur;
        }
        return null;
      },
      querySelector: (sel) => el.querySelectorAll(sel)[0] || null,
      querySelectorAll: (sel) => {
        const out = [];
        const walk = (n) => {
          for (const ch of n.children || []) {
            if (
              (sel.includes("input") && ch.tagName === "INPUT") ||
              (sel.includes("sd-Input-message") && /sd-Input-message/.test(ch.className)) ||
              (sel.includes("sd-Select-container") && /sd-Select-container/.test(ch.className)) ||
              (sel.includes("[class*='label']") && /label/.test(ch.className)) ||
              (sel.includes("li") && ch.tagName === "LI") ||
              (sel.includes("span") && ch.tagName === "SPAN") ||
              (sel.includes("div") && ch.tagName === "DIV") ||
              (sel.includes("label") && ch.tagName === "LABEL") ||
              sel === "*"
            ) out.push(ch);
            walk(ch);
          }
        };
        walk(el);
        return out;
      },
      cloneNode: () => {
        const copy = makeNode({ tagName: el.tagName, className: el.className, textContent: el.textContent });
        copy.querySelectorAll = () => [];
        return copy;
      },
      getBoundingClientRect: () => ({ width: 120, height: 32, left: 0, top: 0, right: 120, bottom: 32 }),
      getRootNode: () => doc,
    };
    return el;
  };
  const append = (parent, child) => {
    child.parentElement = parent;
    const prev = parent.children[parent.children.length - 1] || null;
    if (prev) { prev.nextElementSibling = child; prev.nextSibling = child; }
    child.previousElementSibling = prev;
    parent.children.push(child);
    return child;
  };
  const body = makeNode({ tagName: "BODY" });
  // Moka field with sd-Input-message-LkDNM validation error text
  const formItem = append(body, makeNode({ tagName: "DIV", className: "form-item" }));
  append(formItem, makeNode({ tagName: "DIV", className: "field-title", textContent: "学历" }));
  const sdSel = append(formItem, makeNode({ tagName: "LABEL", className: "sd-Input-container sd-Select-container" }));
  append(sdSel, makeNode({ tagName: "INPUT", type: "text", attrs: { placeholder: "请选择" } }));
  append(sdSel, makeNode({ tagName: "DIV", className: "sd-Input-message-LkDNM sd-Input-error-_Z3Qd", textContent: "必填项未填写" }));

  // Wind #gender + #gender-area-info ul li
  const windRow = append(body, makeNode({ tagName: "DIV", className: "item" }));
  append(windRow, makeNode({ tagName: "DIV", className: "item_title", textContent: "性别*" }));
  const windWrap = append(windRow, makeNode({ tagName: "DIV" }));
  const genderInput = append(windWrap, makeNode({ tagName: "INPUT", id: "gender", type: "text", attrs: { placeholder: "请选择性别", type: "text" } }));
  const areaInfo = append(windWrap, makeNode({ tagName: "DIV", id: "gender-area-info" }));
  const ul = append(areaInfo, makeNode({ tagName: "UL", className: "area-info-ul" }));
  append(ul, makeNode({ tagName: "LI", textContent: "男" }));
  append(ul, makeNode({ tagName: "LI", textContent: "女" }));

  const doc = {
    body,
    querySelectorAll: (s) => body.querySelectorAll(s),
    querySelector: (s) => {
      if (s === "#gender-area-info ul li") return ul.children[0];
      return body.querySelectorAll(s)[0] || null;
    },
    getElementById: (id) => (id === "gender-area-info" ? areaInfo : null),
  };
  const ctx = {
    module: { exports: {} }, exports: {}, document: doc, location: { hostname: "www.wind.com.cn", pathname: "/recruit.html" },
    window: { getComputedStyle: () => ({ visibility: "visible", display: "block" }) },
    CSS: { escape: (v) => v }, Set, Map, Array, Object, String, Number, Boolean, RegExp, Math,
  };
  vm.createContext(ctx);
  vm.runInContext(`${source}\nmodule.exports.scanPageFields = scanPageFields;`, ctx);
  const scanned = ctx.module.exports.scanPageFields("t-", true);
  const mokaEdu = scanned.find((f) => f.tag === "custom-select" && f.label !== "性别*");
  assert.ok(mokaEdu);
  assert.equal(mokaEdu.label, "学历");
  const windGender = scanned.find((f) => f.label === "性别*" || f.placeholder === "请选择性别");
  assert.ok(windGender);
  assert.equal(windGender.tag, "custom-select");
});

test("v71: fillCustomSelects handles overseas university alias, city->province cascader, salary brackets, and Wind *-area-info", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");
  function runPick(opts, p, extra = {}) {
    let clicked = "";
    let typedLog = [];
    const optNodes = opts.map((text) => ({
      textContent: text,
      children: [],
      getBoundingClientRect: () => ({ width: 100, height: 28 }),
      querySelector: () => null,
      dispatchEvent: () => {},
      click: () => { clicked = text; },
    }));
    const input = {
      id: extra.inputId || "",
      value: "",
      matches: (s) => s.includes("input") && !s.includes("phoenix"),
      focus: () => {},
      click: () => {},
      blur: () => {},
      dispatchEvent: () => {},
      getAttribute: () => "",
    };
    const container = {
      className: extra.className || "ant-select",
      matches: (s) => s.split(",").some((x) => x.trim() === `.${extra.className || "ant-select"}`),
      classList: { contains: (c) => c === (extra.className || "ant-select") },
      closest: (s) => (s === ".cascader-plugins-wrap" && extra.cascaderWrap ? {} : null),
      getAttribute: () => null,
      setAttribute: () => {},
      hasAttribute: () => false,
      style: { setProperty: () => {} },
      querySelector: (s) => {
        if (s.includes("input")) return input;
        if (s.includes("ant-select-selection-item")) return clicked ? { textContent: clicked } : null;
        return null;
      },
      querySelectorAll: () => [],
      cloneNode: () => ({ querySelectorAll: () => [], textContent: clicked }),
      click: () => {},
      dispatchEvent: () => {},
      getBoundingClientRect: () => ({ width: 120, height: 32 }),
    };
    const areaDiv = extra.areaDiv ? {
      getBoundingClientRect: () => ({ width: 120, height: 120 }),
      querySelectorAll: () => optNodes,
    } : null;
    const doc = {
      activeElement: null,
      documentElement: { getAttribute: () => null },
      body: { dispatchEvent: () => {}, click: () => {} },
      getElementById: (id) => (extra.inputId && id === `${extra.inputId}-area-info` ? areaDiv : null),
      querySelectorAll: (s) => {
        if (s === "*") return [];
        if (s.includes("ant-select-item-option") && !extra.areaDiv) return optNodes;
        return [];
      },
      querySelector: (s) => (s === `[data-cp-fill-id="${p.id}"]` ? container : null),
    };
    const win = {
      HTMLInputElement: { prototype: Object.getOwnPropertyDescriptor(Object.defineProperty({}, "value", {
        get() { return this._v || ""; },
        set(v) { this._v = v; typedLog.push(v); },
      }), "value") ? { prototype: null } : null },
    };
    const proto = {};
    Object.defineProperty(proto, "value", {
      get() { return this._val || ""; },
      set(v) { this._val = v; typedLog.push(v); },
      configurable: true,
    });
    const ctx = {
      module: { exports: {} },
      exports: {},
      document: doc,
      window: { HTMLInputElement: { prototype: proto } },
      CSS: { escape: (x) => x },
      InputEvent: function (t) { this.type = t; },
      Event: function (t) { this.type = t; },
      FocusEvent: function (t) { this.type = t; },
      MouseEvent: function (t) { this.type = t; },
      KeyboardEvent: function (t) { this.type = t; },
      Set, Map, Array, Object, String, Number, Boolean, RegExp, Math, Promise, Error, setTimeout, clearTimeout,
    };
    vm.createContext(ctx);
    vm.runInContext(`${source}\nmodule.exports.fillCustomSelects = fillCustomSelects;`, ctx);
    return ctx.module.exports.fillCustomSelects([p], "").then((res) => ({ res, clicked, typedLog }));
  }

  // 1. Salary range matching
  return Promise.all([
    runPick(["面议", "5k-10k", "10k-15k", "15k-25k"], { id: "s1", label: "期望薪酬", value: "12000" }),
    // 2. City -> Province lookup in paired province+city cascader
    runPick(["北京市", "天津市", "河北省", "江苏省", "浙江省", "广东省", "四川省", "湖北省", "山东省"], { id: "s2", label: "期望工作地点", value: "南京" }, { cascaderWrap: true }),
    // 3. Overseas school search stripping foreign country prefix ("英国剑桥大学" -> "剑桥大学")
    runPick(["清华大学", "北京大学", "剑桥大学", "牛津大学"], { id: "s3", label: "学校名称（中文）", value: "英国剑桥大学" }),
    // 4. Small fixed list (学习形式) must NOT type unknown search string that wipes options
    runPick(["全日制", "非全日制"], { id: "s4", label: "学习形式", value: "海外留学生", alternatives: ["海外留学", "全日制"] }),
    // 5. Wind *-area-info custom dropdown
    runPick(["男", "女"], { id: "s5", label: "性别*", value: "女" }, { inputId: "gender", areaDiv: true }),
  ]).then(([sal, prov, school, study, wind]) => {
    assert.equal(sal.clicked, "10k-15k");
    assert.deepEqual([...sal.res.filled], ["s1"]);

    assert.equal(prov.clicked, "江苏省");
    assert.deepEqual([...prov.res.filled], ["s2"]);

    assert.equal(school.clicked, "剑桥大学");
    assert.deepEqual([...school.res.filled], ["s3"]);

    assert.equal(study.clicked, "全日制");
    assert.equal(study.typedLog.length, 0);
    assert.deepEqual([...study.res.filled], ["s4"]);

    assert.equal(wind.clicked, "女");
    assert.deepEqual([...wind.res.filled], ["s5"]);
  });
});

test("v72: user-saved & hand-typed idType, idNumber, passportNumber, and customFields auto-learn and auto-fill cleanly without isolating them", () => {
  const ts = require("typescript");
  const profileSrc = fs.readFileSync(path.join(__dirname, "../src/lib/application-profile.ts"), "utf8");
  const compiled = ts.transpileModule(profileSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require });
  const { parseApplicationProfile, describeApplicationProfile } = mod.exports;

  const parsed = parseApplicationProfile({
    extras: { idType: "居民身份证", idNumber: "110101199901011234", passportNumber: "E12345678", politics: "中共党员" },
    customFields: [{ id: "cf1", label: "学生证号", value: "202400198" }, { id: "cf2", label: "银行卡开户行", value: "中国银行上海分行" }],
  });
  assert.equal(parsed.extras.idNumber, "110101199901011234");
  assert.equal(parsed.customFields.length, 2);

  // Privacy: private IDs and customFields NEVER appear in AI prompt digest!
  const digest = describeApplicationProfile(parsed);
  assert.ok(digest.includes("中共党员"));
  assert.ok(!digest.includes("110101199901011234"));
  assert.ok(!digest.includes("E12345678"));
  assert.ok(!digest.includes("202400198"));
  assert.ok(!digest.includes("银行卡开户行"));

  // Autofill matcher: fills explicit ID/custom fields, auto-learns hand-typed IDs, skips third-party rows
  const source = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");
  const ctx = {
    module: { exports: {} },
    exports: {},
    Set, Map, Array, Object, String, Number, Boolean, RegExp, Math, URL, URLSearchParams, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(`${source}\nmodule.exports.__test = { savedExplicitPersonalValue, isNeverGuessField, learnableProfileKey, profileChoices, suggestValidationRepair };`, ctx);
  const { savedExplicitPersonalValue, isNeverGuessField, learnableProfileKey, profileChoices, suggestValidationRepair } = ctx.module.exports.__test;

  assert.equal(isNeverGuessField({ label: "身份证号", placeholder: "", name: "" }), true);
  assert.equal(learnableProfileKey({ label: "身份证号", placeholder: "", name: "", tag: "input", type: "text" }), "idNumber");
  assert.equal(learnableProfileKey({ label: "证件类型", placeholder: "", name: "", tag: "custom-select", type: "" }), "idType");
  assert.equal(learnableProfileKey({ label: "护照号码", placeholder: "", name: "", tag: "input", type: "text" }), "passportNumber");
  assert.equal(learnableProfileKey({ label: "父亲身份证号", section: "家庭成员", placeholder: "", name: "", tag: "input", type: "text" }), null);
  assert.equal(learnableProfileKey({ label: "登录密码", placeholder: "", name: "", tag: "input", type: "password" }), null);
  assert.equal(savedExplicitPersonalValue({ label: "身份证号", placeholder: "", name: "", section: "个人信息" }, {}), null);
  const richProfile = {
    idType: "居民身份证",
    idNumber: "110101199901011234",
    passportNumber: "E12345678",
    customFields: [{ id: "cf1", label: "学生证号", value: "202400198" }],
  };
  assert.equal(savedExplicitPersonalValue({ label: "身份证号码*", placeholder: "", name: "", section: "个人信息" }, richProfile)?.value, "110101199901011234");
  assert.equal(savedExplicitPersonalValue({ label: "身份证有效期", placeholder: "", name: "", section: "个人信息" }, richProfile), null);
  assert.equal(savedExplicitPersonalValue({ label: "证件类型", placeholder: "", name: "", section: "个人信息" }, richProfile)?.value, "居民身份证");
  assert.ok(savedExplicitPersonalValue({ label: "证件类型", placeholder: "", name: "", section: "个人信息" }, richProfile)?.alternatives.includes("二代身份证"));
  assert.equal(savedExplicitPersonalValue({ label: "护照号码", placeholder: "", name: "", section: "个人信息" }, richProfile)?.value, "E12345678");
  assert.equal(savedExplicitPersonalValue({ label: "学生证号", placeholder: "", name: "", section: "教育背景" }, richProfile)?.value, "202400198");
  assert.equal(savedExplicitPersonalValue({ label: "父亲身份证号", placeholder: "", name: "", section: "家庭成员" }, richProfile), null);

  const choices = profileChoices(richProfile);
  assert.ok(choices.some((c) => c.ref === "idNumber" && c.value === "110101199901011234"));
  assert.ok(choices.some((c) => c.ref === "custom:cf1" && c.value === "202400198"));
  assert.equal(suggestValidationRepair({ label: "身份证号", maxLength: 18 }, { value: "110101199901011234 ", source: "profile" }, ""), null);

  const learningSrc = fs.readFileSync(path.join(__dirname, "../src/lib/profile-learning.ts"), "utf8");
  assert.match(learningSrc, /"idNumber"/);

  const assistantSrc = fs.readFileSync(path.join(__dirname, "../src/components/browser/application-assistant.tsx"), "utf8");
  assert.match(assistantSrc, /saveQuickPersonalProfile/);
  assert.match(assistantSrc, /补充个人资料 \/ 自定义空栏/);
  assert.doesNotMatch(assistantSrc, /type=\{slot\.secret/);
  assert.doesNotMatch(assistantSrc, /maskSecret/);
});

test("v73 Batch 1: detectLoginGateCleared read-only, clickAddBlock long headings, resilient profile parsing, and smart pending evaluation", () => {
  const ts = require("typescript");

  // 1. detectLoginGateCleared calls scanFn("readonly-", true, false, true) & counts unfilled fields
  const bvSrc = fs.readFileSync(path.join(__dirname, "../electron/browser-view.js"), "utf8");
  assert.match(bvSrc, /scanFn\("readonly-", true, false, true\)/);
  assert.match(bvSrc, /fields\.filter\(\(f\) => !f\?\.hasValue\)\.length/);
  assert.match(bvSrc, /formWatch\.lastSignature\.delete\(id\)/);

  // 2. autofill-core improvements: lightweight scan, extended clickAddBlock, maxRounds=12, idle short-circuit, picker validation, applyAutofillPlan recomputed alternatives
  const coreSrc = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");
  assert.match(coreSrc, /function scanPageFields\(prefix, readOnly = false, preserveIds = false, lightweight = false\)/);
  assert.match(coreSrc, /再加一条/);
  assert.match(coreSrc, /const maxRounds = options\.saveBlocks \? 24 : 12;/);
  assert.match(coreSrc, /await frameHasUserEdits\(adapter\)/);
  assert.match(coreSrc, /const recomputedAlts = changed/);
  assert.match(coreSrc, /replace\(\/:\\d\+\$\/, ""\)/);

  // 3. Resilient parseApplicationProfile & blank customField filtering
  const profileSrc = fs.readFileSync(path.join(__dirname, "../src/lib/application-profile.ts"), "utf8");
  const compiledProfile = ts.transpileModule(profileSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const pMod = { exports: {} };
  vm.runInNewContext(compiledProfile, { exports: pMod.exports, module: pMod, require });
  const { parseApplicationProfile } = pMod.exports;

  // Blank custom field row is stripped without failing parse; label-only row survives; corrupt `awards` doesn't wipe `extras`
  const salvaged = parseApplicationProfile({
    extras: { idNumber: "110101199901011234", politics: "中共党员" },
    customFields: [
      { id: "cf-empty", label: "   ", value: "" },
      { id: "cf-slot", label: "学号", value: "" },
      { id: "cf-val", label: "开户行", value: "中国银行" },
    ],
    awards: "not-an-array",
  });
  assert.equal(salvaged.extras.idNumber, "110101199901011234");
  assert.equal(salvaged.customFields.length, 2);
  assert.equal(salvaged.customFields[0].label, "学号");
  assert.equal(salvaged.customFields[0].value, "");
  assert.equal(salvaged.awards.length, 0);

  // 4. Smart evaluation & custom field auto-learning in source
  const pendingSrc = fs.readFileSync(path.join(__dirname, "../src/lib/pending-application-change.ts"), "utf8");
  assert.match(pendingSrc, /export function evaluatePendingChange\(/);
  assert.match(pendingSrc, /recommendedTarget: "resume_template"/);

  const pendingActionSrc = fs.readFileSync(path.join(__dirname, "../src/lib/actions/pending-application-change.ts"), "utf8");
  assert.match(pendingActionSrc, /syncPendingToResumeTemplate/);
  assert.match(pendingActionSrc, /answerToCustomField/);

  const reviewSrc = fs.readFileSync(path.join(__dirname, "../src/components/browser/inline-pending-review.tsx"), "utf8");
  assert.match(reviewSrc, /更新资料与简历模板/);
  assert.match(reviewSrc, /存为自定义栏位/);
});

test("v74 Batch 2: Outlook Windows TZID normalization, deadline timeZone propagation, inbox-scan same-batch linking, multi-day calendar & kanban drag-drop", () => {
  const ts = require("typescript");

  // 1. Outlook Windows TZID -> IANA in mail-calendar.ts
  const calSrc = fs.readFileSync(path.join(__dirname, "../src/lib/mail-calendar.ts"), "utf8");
  const compiledCal = ts.transpileModule(calSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const calMod = { exports: {} };
  vm.runInNewContext(compiledCal, { exports: calMod.exports, module: calMod, require });
  const { normalizeCalendarTimeZone, parseCalendarInvite } = calMod.exports;

  assert.equal(normalizeCalendarTimeZone("Pacific Standard Time"), "America/Los_Angeles");
  assert.equal(normalizeCalendarTimeZone('"China Standard Time"'), "Asia/Shanghai");
  assert.equal(normalizeCalendarTimeZone("Eastern Standard Time"), "America/New_York");
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Technical Interview",
    "DTSTART;TZID=\"Pacific Standard Time\":20261125T100000",
    "DTEND;TZID=\"Pacific Standard Time\":20261125T110000",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const parsedInvite = parseCalendarInvite(ics);
  assert.equal(parsedInvite.timeZone, "America/Los_Angeles");

  // 2. mail-time-extract.ts propagates zone on booking/deadline
  const extractSrc = fs.readFileSync(path.join(__dirname, "../src/lib/mail-time-extract.ts"), "utf8");
  assert.match(extractSrc, /timeZone: booked\.zone/);
  assert.match(extractSrc, /timeZone: cutoff\.zone/);

  // 3. inbox-scan.ts same-batch activeApplications push + per-account classifyEmails try/catch + merge gating
  const scanSrc = fs.readFileSync(path.join(__dirname, "../src/lib/actions/inbox-scan.ts"), "utf8");
  assert.match(scanSrc, /activeApplications\.unshift\(newActive\)/);
  assert.match(scanSrc, /classify failed/);
  assert.match(scanSrc, /if \(scheduled > 0 \|\| found > 0\)/);

  // 4. Calendar multi-day dateEnd filter + company aliases + Kanban drag-drop + Resume delete cleanup
  const deadlineCalSrc = fs.readFileSync(path.join(__dirname, "../src/components/calendar/deadline-calendar.tsx"), "utf8");
  assert.match(deadlineCalSrc, /new Date\(e\.dateEnd \?\? e\.date\)\.getTime\(\) >= now - 86400000/);

  const calPageSrc = fs.readFileSync(path.join(__dirname, "../src/app/(dashboard)/calendar/page.tsx"), "utf8");
  assert.match(calPageSrc, /aliases: a\.company\.aliases\.map/);

  const boardSrc = fs.readFileSync(path.join(__dirname, "../src/components/applications/applications-board.tsx"), "utf8");
  assert.match(boardSrc, /handleLaneDrop/);
  assert.match(boardSrc, /setOptimisticStage/);

  const resumeSrc = fs.readFileSync(path.join(__dirname, "../src/lib/actions/resumes.ts"), "utf8");
  assert.match(resumeSrc, /resumeVersionId: null/);
});

test("v75 Smooth 3-piece suite: confidence tiering, preflight check, 3s review checklist & persistent batch queue", () => {
  const coreSrc = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");
  const ctx = {
    module: { exports: {} },
    exports: {},
    Set, Map, Array, Object, String, Number, Boolean, RegExp, Math, URL, URLSearchParams, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(`${coreSrc}\nmodule.exports.__test = { fillDetail };`, ctx);
  const { fillDetail } = ctx.module.exports.__test;

  const filledSet = new Set(["a", "b", "c"]);
  const f = (id, label) => ({ id, label, placeholder: "", name: "", tag: "input", type: "text" });
  assert.equal(fillDetail(f("a", "姓名"), { id: "a", value: "张三", source: "profile" }, filledSet, new Set()).confidence, "high");
  assert.equal(fillDetail(f("b", "自我评价"), { id: "b", value: "截短文本", source: "profile", shortened: 100 }, filledSet, new Set()).confidence, "medium");
  assert.equal(fillDetail(f("c", "职业规划"), { id: "c", value: "AI 答案", source: "ai" }, filledSet, new Set()).confidence, "medium");
  assert.equal(fillDetail(f("d", "其他问题"), undefined, filledSet, new Set()).confidence, "low");

  assert.match(coreSrc, /summary\.preflight = \{/);
  const assistantSrc = fs.readFileSync(path.join(__dirname, "../src/components/browser/application-assistant.tsx"), "utf8");
  assert.match(assistantSrc, /提交前体检/);
  assert.match(assistantSrc, /建议 3 秒核对/);

  const bvSrc = fs.readFileSync(path.join(__dirname, "../electron/browser-view.js"), "utf8");
  assert.match(bvSrc, /batch-queue\.json/);
  assert.match(bvSrc, /browser:resume-saved-batch/);

  const ebSrc = fs.readFileSync(path.join(__dirname, "../src/components/browser/embedded-browser.tsx"), "utf8");
  assert.match(ebSrc, /断点续投/);
});

test("v76 SOE (央国企) & universal portal adaptation: horizontal table headers, Layui/Select2/EasyUI selectors, study years/training mode, and SOE 18-questions", () => {
  const coreSrc = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");
  const ctx = {
    module: { exports: {} },
    exports: {},
    Set, Map, Array, Object, String, Number, Boolean, RegExp, Math, Date, URL, URLSearchParams, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(`${coreSrc}\nmodule.exports.__test = { matchFlatField, studyYearsOption, studyFormValue, customValueAlternatives, derivePostalCode };`, ctx);
  const { matchFlatField, studyYearsOption, studyFormValue, customValueAlternatives, derivePostalCode } = ctx.module.exports.__test;

  const soeProfile = {
    currentCity: "上海",
    education: [{ school: "上海交通大学", degree: "硕士研究生", major: "控制科学与工程", start: "2024-09", end: "2027-06" }],
  };
  const f = (label, extra = {}) => ({ label, placeholder: "", name: "", tag: "input", type: "text", ...extra });

  // 1. SOE high-frequency questions
  assert.equal(matchFlatField(f("专业技术职务"), soeProfile), "无");
  assert.equal(matchFlatField(f("有无违法违纪行为", { tag: "select", options: ["有", "无"] }), soeProfile), "无");
  assert.equal(matchFlatField(f("是否服从工作地点分配", { tag: "select", options: ["是", "否"] }), soeProfile), "是");
  assert.equal(matchFlatField(f("毕(结)业"), soeProfile), "在读");
  assert.equal(matchFlatField(f("学位证书编号"), soeProfile), "暂未取得");
  assert.equal(matchFlatField(f("邮政编码"), soeProfile), "200000");
  assert.equal(derivePostalCode("江苏省南京市玄武区"), "210000");

  // 2. SOE 培养方式 & 学制
  assert.equal(studyFormValue(f("培养方式", { tag: "select", options: ["定向", "非定向", "委培"] }), soeProfile.education[0]), "非定向");
  assert.equal(studyFormValue(f("招生类别", { tag: "select", options: ["统招", "非统招"] }), soeProfile.education[0]), "统招");
  assert.equal(studyYearsOption(f("学制", { tag: "select", options: ["2", "3", "4", "5"] }), { degree: "本科", start: "2020-09", end: "2024-06" }), "4");
  assert.equal(studyYearsOption(f("学制", { tag: "select", options: ["二年制", "三年制", "四年制"] }), { degree: "硕士研究生", start: "2024-09", end: "2027-06" }), "三年制");
  assert.ok(customValueAlternatives("4年", "years").includes("四年制"));
  assert.ok(customValueAlternatives("全日制", "mode").includes("非定向"));

  // 3. Horizontal table header lookup & Layui/Select2/EasyUI selectors in scanPageFields
  assert.match(coreSrc, /thead tr/);
  assert.match(coreSrc, /\.layui-form-select/);
  assert.match(coreSrc, /\.select2-results__option/);
  assert.match(coreSrc, /\.combobox-item/);
});
