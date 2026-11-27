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
    `${source}\nmodule.exports.__test = { scanPageFields, fillFields, resolveRepeatField, repeatFieldValue, matchBasicField, matchFlatField, matchFieldOption, matchPhoneChoice, savedThirdPartyValue, savedExplicitPersonalValue, isThirdPartyField, customValueAlternatives };`,
    context
  );
  return context.module.exports.__test;
}

const SYNTHETIC_PROFILE = {
  name: "林测试",
  gender: "女",
  birthDate: "2002-05-15",
  phone: "13800138000",
  email: "test.lin@example.com",
  idType: "居民身份证",
  idNumber: "440300200205151234",
  ethnicity: "汉族",
  nationality: "中国",
  politics: "共青团员",
  health: "健康",
  hometown: "广东省广州市",
  householdPlace: "广东省广州市",
  sourcePlace: "广东省广州市",
  birthplace: "广东省广州市",
  currentCity: "深圳市",
  address: "广东省深圳市南山区科技园1号",
  emergencyName: "林建国",
  emergencyPhone: "13900139000",
  emergencyRelation: "父亲",
  availableFrom: "2026-12-01",
  internshipDuration: "3个月",
  acceptAdjust: "是",
  jobSource: "官网",
  english: "CET-6 580",
  rank: "前10%",
  education: [
    {
      school: "中山大学",
      degree: "硕士",
      major: "人力资源管理",
      studyForm: "全日制",
      start: "2024-09",
      end: "2027-06",
      gpa: "3.85/4.0",
    },
    {
      school: "暨南大学",
      degree: "本科",
      major: "工商管理",
      studyForm: "全日制",
      start: "2020-09",
      end: "2024-06",
      gpa: "3.70/4.0",
    },
  ],
  projects: [
    {
      name: "校园雇主品牌推广项目",
      role: "项目负责人",
      start: "2025-03",
      end: "2025-06",
      description: "策划高校宣讲会及新媒体传播。",
      responsibilities: "",
    },
  ],
};

test("v2.2.1 samples4: Moka single-line 职责 (maxLength=255) maps to role, 紧急联络人 fills emergencyName", () => {
  const core = loadAutofillCore();
  const rowIndexes = new Map();
  const roleField = {
    id: "p-role",
    tag: "input",
    type: "text",
    maxLength: 255,
    section: "项目经验添加",
    label: "职责",
    placeholder: "职责",
    name: "",
  };
  const info = core.resolveRepeatField(roleField, rowIndexes);
  assert.ok(info);
  assert.equal(info.group, "project");
  assert.equal(info.kind, "role");
  assert.equal(core.repeatFieldValue(roleField, info, SYNTHETIC_PROFILE), "项目负责人");

  const respTextarea = {
    id: "p-resp",
    tag: "textarea",
    type: "textarea",
    maxLength: 1000,
    section: "项目经验添加",
    label: "职责",
    placeholder: "请输入职责描述",
    name: "",
  };
  const respInfo = core.resolveRepeatField(respTextarea, new Map());
  assert.equal(respInfo.kind, "responsibilities");

  const emergencyField = { id: "e1", tag: "input", type: "text", section: "个人信息", label: "紧急联络人", placeholder: "紧急联络人", name: "" };
  assert.equal(core.isThirdPartyField(emergencyField), true);
  assert.equal(core.savedThirdPartyValue(emergencyField, SYNTHETIC_PROFILE, new Map()), "林建国");
});

test("v2.2.1 samples4: 51job 入学前户口所在地/生源地 not treated as start date, cascading select + phone choice + 通信地址 + ID select", () => {
  const core = loadAutofillCore();
  const provinceOpts = ["北京", "上海", "广东省", "深圳", "天津", "江苏省"];

  const hukouSource = {
    id: "s1",
    tag: "select",
    type: "select-one",
    section: "基本信息",
    label: "入学前户口所在地/生源地 *",
    placeholder: "",
    name: "ddl_CCE1_5_1",
    options: provinceOpts,
  };
  assert.equal(core.resolveRepeatField(hukouSource, new Map()), null);
  assert.equal(core.matchBasicField(hukouSource, SYNTHETIC_PROFILE, new Map()), "广东省");

  // Prefix tie-break: "广东省深圳市" against ["广东省", "深圳"] picks "广东省"
  assert.equal(core.matchFieldOption({ options: provinceOpts }, "广东省深圳市"), "广东省");

  // Empty options on cascading child <select> passes through raw value for dynamic fillFields matching
  const childSelect = {
    id: "s2",
    tag: "select",
    type: "select-one",
    section: "基本信息",
    label: "户口所在地 *",
    placeholder: "",
    name: "cc_Hukou_1_1",
    options: [],
  };
  assert.equal(core.matchBasicField(childSelect, SYNTHETIC_PROFILE, new Map()), "广东省广州市");

  // 51job phone country code <select> labeled "手机号码 *"
  const phoneSel = {
    id: "s3",
    tag: "select",
    type: "select-one",
    section: "基本信息",
    label: "手机号码 *",
    placeholder: "",
    name: "",
    options: ["中国大陆（+86）", "其他地区手机号"],
  };
  assert.equal(core.matchPhoneChoice(phoneSel, SYNTHETIC_PROFILE), "中国大陆（+86）");

  // 通信地址 alias
  const addrField = { id: "a1", tag: "input", type: "text", section: "基本信息", label: "通信地址", placeholder: "", name: "cc_Address_5_1" };
  assert.equal(core.matchBasicField(addrField, SYNTHETIC_PROFILE, new Map()), SYNTHETIC_PROFILE.address);

  // 51job ID type <select> labeled 证件号码
  const idSel = {
    id: "id1",
    tag: "select",
    type: "select-one",
    section: "基本信息",
    label: "证件号码",
    placeholder: "",
    name: "sIDCard",
    options: ["国内身份证或护照（含港澳台）", "国外身份证"],
  };
  const explicitId = core.savedExplicitPersonalValue(idSel, SYNTHETIC_PROFILE);
  assert.equal(explicitId?.value, "国内身份证或护照（含港澳台）");
});

test("v2.2.1 samples4: 填表日期, 可实习时间 (date vs duration), 最高学历所在地, 教育类型, 是否统招, 本科开始/结束时间, 渠道/调剂 aliases", () => {
  const core = loadAutofillCore();

  // 填表日期 -> today's YYYY-MM-DD
  const fillDateField = { id: "d1", tag: "input", type: "text", section: "其他信息添加", label: "填表日期", placeholder: "日期（年月日）", name: "" };
  const today = new Date();
  const expectedToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  assert.equal(core.matchBasicField(fillDateField, SYNTHETIC_PROFILE, new Map()), expectedToday);

  // 可实习时间 with date placeholder -> availableFrom; without -> internshipDuration
  const internDate = { id: "d2", tag: "input", type: "text", section: "", label: "可实习时间", placeholder: "日期（年月日）", name: "" };
  assert.equal(core.matchBasicField(internDate, SYNTHETIC_PROFILE, new Map()), "2026-12-01");
  const internDur = { id: "d3", tag: "input", type: "text", section: "", label: "可实习时间", placeholder: "如3个月", name: "" };
  assert.equal(core.matchBasicField(internDur, SYNTHETIC_PROFILE, new Map()), "3个月");

  // 最高学历所在地 / 最高学历所在区域 -> school country (NOT currentCity)
  const eduLoc = { id: "el1", tag: "custom-select", type: "", section: "个人信息", label: "最高学历所在地", placeholder: "请选择", name: "" };
  assert.equal(core.matchBasicField(eduLoc, SYNTHETIC_PROFILE, new Map()), "中国");
  const eduLocAlts = core.customValueAlternatives("中国", "", eduLoc);
  assert.ok(eduLocAlts.includes("中国大陆") && eduLocAlts.includes("国内"));

  // 教育类型 inside education block -> mode -> 全日制
  const eduType = { id: "et1", tag: "custom-select", type: "", section: "教育背景添加", label: "教育类型", placeholder: "请选择", name: "" };
  const eduTypeInfo = core.resolveRepeatField(eduType, new Map());
  assert.equal(eduTypeInfo?.group, "education");
  assert.equal(eduTypeInfo?.kind, "mode");
  assert.equal(core.repeatFieldValue(eduType, eduTypeInfo, SYNTHETIC_PROFILE), "全日制");

  // 是否统招 -> 是
  const tongzhao = { id: "tz1", tag: "custom-select", type: "", section: "教育背景添加", label: "是否统招", placeholder: "请选择", name: "" };
  assert.equal(core.matchBasicField(tongzhao, SYNTHETIC_PROFILE, new Map()), "是");

  // 本科开始时间 / 本科结束时间 outside education section
  const ugStart = { id: "ug1", tag: "custom-select", type: "", section: "个人信息", label: "本科开始时间", placeholder: "年", name: "", datePart: "year" };
  const ugEnd = { id: "ug2", tag: "custom-select", type: "", section: "个人信息", label: "本科结束时间", placeholder: "年", name: "", datePart: "year" };
  assert.equal(core.matchBasicField(ugStart, SYNTHETIC_PROFILE, new Map()), "2020-09");
  assert.equal(core.matchBasicField(ugEnd, SYNTHETIC_PROFILE, new Map()), "2024-06");

  // 户口地址, 家庭所在地, 获取职位信息的渠道, 校招的途径, 异地调派, 工作地点调配, 方向调剂
  assert.equal(core.matchBasicField({ id: "h1", tag: "input", label: "户口地址", placeholder: "", section: "", name: "" }, SYNTHETIC_PROFILE, new Map()), "广东省广州市");
  assert.equal(core.matchBasicField({ id: "h2", tag: "custom-select", label: "家庭所在地（城市）", placeholder: "请选择", section: "个人信息", name: "" }, SYNTHETIC_PROFILE, new Map()), "广东省广州市");
  assert.equal(core.matchBasicField({ id: "j1", tag: "custom-select", label: "获取职位信息的渠道", placeholder: "", section: "基本信息", name: "" }, SYNTHETIC_PROFILE, new Map()), "官网");
  assert.equal(core.matchBasicField({ id: "j2", tag: "custom-select", label: "了解到明源云校招的途径 ？", placeholder: "请选择", section: "个人信息", name: "" }, SYNTHETIC_PROFILE, new Map()), "官网");
  assert.equal(core.matchBasicField({ id: "a1", tag: "custom-select", label: "是否接受异地调派", placeholder: "", section: "求职意向", name: "" }, SYNTHETIC_PROFILE, new Map()), "是");
  assert.equal(core.matchBasicField({ id: "a2", tag: "custom-select", label: "人力资源岗需要接受工作地点调配（北/深），请问是否可以接受？", placeholder: "请选择", section: "个人信息", name: "" }, SYNTHETIC_PROFILE, new Map()), "是");
  assert.equal(core.matchBasicField({ id: "a3", tag: "select", label: "是否服从方向调剂 *", placeholder: "", section: "基本信息", name: "", options: ["是", "否"] }, SYNTHETIC_PROFILE, new Map()), "是");

  // customValueAlternatives for health, english, rank
  const healthAlts = core.customValueAlternatives("健康", "", { label: "您的健康状况如何？" });
  assert.ok(healthAlts.includes("良好") && healthAlts.includes("无疾病"));
  const engAlts = core.customValueAlternatives("CET-6 580", "", { label: "英语能力证明标准" });
  assert.ok(engAlts.includes("大学英语六级") && engAlts.includes("CET-6"));
  const rankAlts = core.customValueAlternatives("前10%", "", { label: "年级排名" });
  assert.ok(rankAlts.includes("5%-10%") && rankAlts.includes("前20%"));
});

test("v2.2.1 samples4: scanPageFields ignores Element Plus aria-label='radio-group' and 51job '务必填写此项'", () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");
  const makeNode = (props) => {
    const attrs = new Map(Object.entries(props.attrs || {}));
    const el = {
      tagName: (props.tagName || "DIV").toUpperCase(),
      type: props.type || "",
      id: props.id || "",
      name: props.name || "",
      className: props.className || "",
      classList: { contains: (c) => (props.className || "").split(/\s+/).includes(c) },
      textContent: props.textContent || "",
      innerText: props.textContent || "",
      value: props.value || "",
      checked: !!props.checked,
      readOnly: !!props.readOnly,
      disabled: !!props.disabled,
      options: props.options || [],
      selectedIndex: props.selectedIndex ?? 0,
      parentElement: null,
      children: [],
      previousElementSibling: null,
      nextElementSibling: null,
      nextSibling: null,
      shadowRoot: null,
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : k === "name" ? el.name : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      hasAttribute: (k) => attrs.has(k),
      removeAttribute: (k) => attrs.delete(k),
      matches: (sel) => sel.split(",").some((part) => {
        const s = part.trim();
        if (s === "input" || s === "INPUT") return el.tagName === "INPUT";
        if (s === "select") return el.tagName === "SELECT";
        if (s.includes("label")) return el.tagName === "LABEL" || /label/.test(el.className);
        if (s === "[role='radiogroup']") return attrs.get("role") === "radiogroup";
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
            if (k === "[role='radiogroup']") return cur.getAttribute("role") === "radiogroup";
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
              sel === "*" ||
              (sel.includes('input[type="radio"]') && ch.tagName === "INPUT" && ch.type === "radio") ||
              (/(?:^|,\s*)select(?:\s*,|$)/.test(sel) && ch.tagName === "SELECT") ||
              (sel.includes(".el-form-item__label") && ch.className.includes("el-form-item__label")) ||
              (!sel.includes("for=") && sel.includes("label") && ch.tagName === "LABEL") ||
              (sel.includes("span") && ch.tagName === "SPAN") ||
              (sel.includes("div") && ch.tagName === "DIV")
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

  // 1. OPPO Element Plus radio group with aria-label="radio-group"
  const elItem = append(body, makeNode({ tagName: "DIV", className: "el-form-item" }));
  append(elItem, makeNode({ tagName: "LABEL", className: "el-form-item__label", textContent: "是否在实验室" }));
  const elContent = append(elItem, makeNode({ tagName: "DIV", className: "el-form-item__content" }));
  const rg = append(elContent, makeNode({ tagName: "DIV", className: "el-radio-group", attrs: { role: "radiogroup", "aria-label": "radio-group" } }));
  const rYesLbl = append(rg, makeNode({ tagName: "LABEL", className: "el-radio", textContent: "是" }));
  append(rYesLbl, makeNode({ tagName: "INPUT", type: "radio", name: "el-id-1" }));
  const rNoLbl = append(rg, makeNode({ tagName: "LABEL", className: "el-radio", textContent: "否" }));
  append(rNoLbl, makeNode({ tagName: "INPUT", type: "radio", name: "el-id-1" }));

  // 2. 51job <dl><dt>证件号码</dt><dd><span>务必填写此项</span><select id="sIDCard">...
  const dl = append(body, makeNode({ tagName: "DL" }));
  append(dl, makeNode({ tagName: "DT", textContent: "证件号码" }));
  const dd = append(dl, makeNode({ tagName: "DD" }));
  append(dd, makeNode({ tagName: "SPAN", id: "Span_IDCard_top", textContent: "务必填写此项" }));
  append(dd, makeNode({
    tagName: "SELECT",
    id: "sIDCard",
    name: "sIDCard",
    options: [
      { value: "", textContent: "--请选择--", disabled: false },
      { value: "1", textContent: "国内身份证或护照（含港澳台）", disabled: false },
      { value: "2", textContent: "国外身份证", disabled: false },
    ],
  }));

  const doc = {
    body,
    querySelectorAll: (s) => body.querySelectorAll(s),
    querySelector: (s) => body.querySelectorAll(s)[0] || null,
    getElementById: () => null,
  };
  const ctx = {
    module: { exports: {} },
    exports: {},
    document: doc,
    location: { hostname: "careers.oppo.com", pathname: "/university/oppo/center/resume" },
    window: { getComputedStyle: () => ({ visibility: "visible", display: "block" }) },
    CSS: { escape: (v) => v },
    Set, Map, Array, Object, String, Number, Boolean, RegExp, Math,
  };
  vm.createContext(ctx);
  vm.runInContext(`${source}\nmodule.exports.scanPageFields = scanPageFields;`, ctx);
  const scanned = ctx.module.exports.scanPageFields("t-", true);

  const radio = scanned.find((f) => f.tag === "radio");
  assert.ok(radio);
  assert.equal(radio.label, "是否在实验室");

  const idSelect = scanned.find((f) => f.tag === "select");
  assert.ok(idSelect);
  assert.equal(idSelect.label, "证件号码");
});

test("v2.2.1 samples4: fillFields routes Moka region_info to pickSdLocation and populates cascading native <select>", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8");

  // Test 1: Moka region_info (出生地 请选择省市区)
  let confirmed = false;
  let pickedTags = [];
  const makeTag = (text, onClick) => ({
    textContent: text,
    getClientRects: () => [{ width: 40, height: 20 }],
    click: () => { pickedTags.push(text); onClick(); },
  });
  let level = 0;
  const provTags = [makeTag("广东省", () => { level = 1; }), makeTag("浙江省", () => { level = 1; })];
  const cityTags = [makeTag("广州市", () => { level = 2; }), makeTag("深圳市", () => { level = 2; })];
  const regionInput = {
    tagName: "INPUT",
    type: "text",
    readOnly: true,
    disabled: false,
    value: "",
    attrs: new Map([["data-cp-fill-id", "f-region"], ["placeholder", "请选择省市区"]]),
    getAttribute: (k) => regionInput.attrs.get(k) || null,
    setAttribute: (k, v) => regionInput.attrs.set(k, String(v)),
    style: { setProperty: () => {} },
    focus: () => {},
    click: () => {},
    dispatchEvent: () => {},
    closest: (sel) => {
      if (sel.includes("region_info") || sel.includes("sd-Dropdown-container")) return regionBox;
      return null;
    },
  };
  const menuEl = {
    querySelectorAll: (sel) => (sel.includes("sd-Tag-container") ? (level === 0 ? provTags : cityTags) : []),
    querySelector: (sel) => (sel.includes("confirm") ? { click: () => { confirmed = true; regionInput.value = "广东省/广州市"; } } : null),
  };
  const regionBox = {
    querySelector: (sel) => (sel.includes("menu-wrapper") ? menuEl : null),
  };

  // Test 2: Cascading native <select> (parent province -> dynamically populates child city)
  const childSelect = {
    tagName: "SELECT",
    type: "select-one",
    readOnly: false,
    disabled: false,
    value: "",
    selectedIndex: 0,
    options: [{ value: "", textContent: "--请选择--", disabled: false }],
    attrs: new Map([["data-cp-fill-id", "f-city"]]),
    getAttribute: (k) => childSelect.attrs.get(k) || null,
    setAttribute: (k, v) => childSelect.attrs.set(k, String(v)),
    style: { setProperty: () => {} },
    closest: () => null,
    dispatchEvent: () => {
      const idx = childSelect.options.findIndex((o) => o.value === childSelect.value);
      if (idx >= 0) childSelect.selectedIndex = idx;
    },
  };
  const parentSelect = {
    tagName: "SELECT",
    type: "select-one",
    readOnly: false,
    disabled: false,
    value: "",
    selectedIndex: 0,
    options: [
      { value: "", textContent: "--请选择--", disabled: false },
      { value: "gd", textContent: "广东省", disabled: false },
    ],
    attrs: new Map([["data-cp-fill-id", "f-prov"]]),
    getAttribute: (k) => parentSelect.attrs.get(k) || null,
    setAttribute: (k, v) => parentSelect.attrs.set(k, String(v)),
    style: { setProperty: () => {} },
    closest: () => null,
    dispatchEvent: (ev) => {
      if (ev.type === "change") {
        const idx = parentSelect.options.findIndex((o) => o.value === parentSelect.value);
        if (idx >= 0) parentSelect.selectedIndex = idx;
        setTimeout(() => {
          childSelect.options = [
            { value: "", textContent: "--请选择--", disabled: false },
            { value: "gz", textContent: "广州", disabled: false },
            { value: "sz", textContent: "深圳", disabled: false },
          ];
        }, 60);
      }
    },
  };

  const byId = { "f-region": regionInput, "f-prov": parentSelect, "f-city": childSelect };
  const doc = {
    body: { dispatchEvent: () => {}, click: () => {} },
    querySelector: (sel) => {
      const m = /data-cp-fill-id="([^"]+)"/.exec(sel);
      return m ? byId[m[1]] || null : null;
    },
    querySelectorAll: () => [],
  };
  const ctx = {
    module: { exports: {} },
    exports: {},
    document: doc,
    window: {
      HTMLInputElement: { prototype: Object.defineProperty({}, "value", { set(v) { this._v = v; }, get() { return this._v; }, configurable: true }) },
      HTMLTextAreaElement: { prototype: Object.defineProperty({}, "value", { set(v) { this._v = v; }, get() { return this._v; }, configurable: true }) },
    },
    MouseEvent: class { constructor(type) { this.type = type; } },
    Event: class { constructor(type) { this.type = type; } },
    InputEvent: class { constructor(type) { this.type = type; } },
    FocusEvent: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    Set, Map, Array, Object, String, Number, Boolean, RegExp, Math, Promise, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(`${source}\nmodule.exports.fillFields = fillFields;`, ctx);
  const res = await ctx.module.exports.fillFields([
    { id: "f-region", value: "广东省广州市", label: "出生地", tag: "input" },
    { id: "f-prov", value: "广东省", label: "户口所在地", tag: "select" },
    { id: "f-city", value: "广东省广州市", label: "户口所在地", tag: "select" },
  ]);

  assert.equal(confirmed, true);
  assert.deepEqual(pickedTags, ["广东省", "广州市"]);
  assert.ok(res.filled.includes("f-region"));
  assert.ok(res.filled.includes("f-prov"));
  assert.ok(res.filled.includes("f-city"));
  assert.equal(childSelect.value, "gz");
});
