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
