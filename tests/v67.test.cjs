const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ExcelJS = require("exceljs");
const core = require("../electron/autofill-core.js");

function loadTs(relFile, mocks = {}) {
  const abs = path.resolve(__dirname, "..", relFile);
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(abs, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const ctx = {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (mocks[id]) return mocks[id];
      if (id.startsWith("@/")) {
        const sub = `src/${id.slice(2)}`;
        const candidate = fs.existsSync(path.resolve(__dirname, "..", `${sub}.ts`))
          ? `${sub}.ts`
          : `${sub}/index.ts`;
        return loadTs(candidate, mocks);
      }
      return require(id);
    },
    console,
    Date,
    Error,
    Buffer,
    URL,
    Intl,
    process,
    Set,
    Map,
    Array,
  };
  vm.runInNewContext(source, ctx);
  return mod.exports;
}

const exportLib = loadTs("src/lib/applications-export.ts");
const answerScope = loadTs("src/lib/autofill-answer-scope.ts");

function makeSampleExportSources() {
  return [
    {
      id: "app-1",
      title: "=HYPERLINK(\"http://evil\",\"数据分析师\")",
      currentStage: "INTERVIEW_2",
      currentStageLabel: "业务二面",
      terminatedAtStage: null,
      appliedDate: "2026-10-10T08:00:00.000Z",
      currentStageDate: "2026-10-20T09:00:00.000Z",
      salaryMin: 25,
      salaryMax: 35,
      city: "上海、杭州",
      source: "官网投递",
      referrer: "+张三",
      portalStatus: "面试中",
      applyUrl: "",
      jdSnapshotUrl: "",
      position: { location: "上海、杭州", jdUrl: "https://jobs.example.com/101" },
      company: { name: "星河科技", industry: "INTERNET", sector: null },
      resumeVersion: { name: "数据分析主简历" },
      stageHistory: [
        {
          id: "h1",
          stage: "APPLIED",
          stageLabel: "已投递",
          enteredAt: "2026-10-10T08:00:00.000Z",
          nextDeadline: null,
          nextDeadlineEnd: null,
          nextHasTime: false,
          meetingInfo: null,
        },
        {
          id: "h2",
          stage: "INTERVIEW_2",
          stageLabel: "业务二面",
          enteredAt: "2026-10-20T09:00:00.000Z",
          nextDeadline: "2026-11-01T10:00:00.000Z",
          nextDeadlineEnd: null,
          nextHasTime: true,
          meetingInfo: "Tencent Meeting",
        },
      ],
    },
    {
      id: "app-2",
      title: "产品运营",
      currentStage: "REJECTED",
      currentStageLabel: "已拒绝",
      terminatedAtStage: "OA",
      appliedDate: "2026-10-05T08:00:00.000Z",
      currentStageDate: "2026-10-15T09:00:00.000Z",
      salaryMin: 20,
      salaryMax: null,
      city: "南京",
      source: "-校招宣讲",
      referrer: null,
      portalStatus: "流程结束",
      applyUrl: "https://jobs.example.com/102",
      jdSnapshotUrl: null,
      position: null,
      company: { name: "星河科技", industry: "OTHER", sector: "人工智能" },
      resumeVersion: { name: "产品通用简历" },
      stageHistory: [
        {
          id: "h3",
          stage: "APPLIED",
          stageLabel: "已投递",
          enteredAt: "2026-10-05T08:00:00.000Z",
          nextDeadline: null,
          nextDeadlineEnd: null,
          nextHasTime: false,
          meetingInfo: null,
        },
        {
          id: "h4",
          stage: "REJECTED",
          stageLabel: "已拒绝",
          terminatedAtStage: "OA",
          enteredAt: "2026-10-15T09:00:00.000Z",
          nextDeadline: null,
          nextDeadlineEnd: null,
          nextHasTime: false,
          meetingInfo: null,
        },
      ],
    },
    {
      id: "app-3",
      title: "@算法实习生",
      currentStage: "OFFER",
      currentStageLabel: "已录用",
      terminatedAtStage: null,
      appliedDate: "2026-10-12T08:00:00.000Z",
      currentStageDate: "2026-10-25T09:00:00.000Z",
      salaryMin: 18,
      salaryMax: 18,
      city: "北京",
      source: "内推",
      referrer: "李四",
      portalStatus: "Offer沟通",
      applyUrl: "https://jobs.example.com/103",
      jdSnapshotUrl: null,
      position: null,
      company: { name: "云图智能", industry: "AI", sector: null },
      resumeVersion: { name: "算法简历" },
      stageHistory: [],
    },
  ];
}

test("applications-export builds rows, company summaries, CSV with formula guard, Markdown, and 2-sheet XLSX", async () => {
  const rows = exportLib.buildApplicationExportRows(makeSampleExportSources(), Date.parse("2026-10-28T00:00:00.000Z"));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].cities, "上海、杭州");
  assert.equal(rows[0].salaryRange, "25-35K");
  assert.equal(rows[0].applyUrl, "https://jobs.example.com/101");
  assert.match(rows[0].stageDisplay, /业务二面/);
  assert.match(rows[0].nextSchedule, /业务二面.*11\/01.*Tencent Meeting/);
  assert.equal(rows[1].endedAt, "笔试");
  assert.equal(rows[1].salaryRange, "20K+");
  assert.equal(rows[2].salaryRange, "18K");

  const companies = exportLib.buildCompanySummaries(rows);
  assert.equal(companies.length, 2);
  const yun = companies.find((c) => c.companyName === "云图智能");
  const xinghe = companies.find((c) => c.companyName === "星河科技");
  assert.equal(yun.offerCount, 1);
  assert.equal(yun.activeCount, 1);
  assert.equal(xinghe.totalCount, 2);
  assert.equal(xinghe.activeCount, 1);
  assert.equal(xinghe.interviewCount, 1);
  assert.equal(xinghe.endedCount, 1);
  assert.equal(xinghe.latestAppliedDate, "2026-10-10");

  // CSV: UTF-8 BOM + CRLF + spreadsheet formula sanitization (=, +, -, @)
  assert.equal(exportLib.sanitizeSpreadsheetCell("=1+1"), "'=1+1");
  assert.equal(exportLib.sanitizeSpreadsheetCell("+1380000"), "'+1380000");
  assert.equal(exportLib.sanitizeSpreadsheetCell("-foo"), "'-foo");
  assert.equal(exportLib.sanitizeSpreadsheetCell("@bar"), "'@bar");
  const csv = exportLib.applicationsToCsv(rows);
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.equal(csv.includes("\r\n"), true);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'\+张三/);
  assert.match(csv, /'-校招宣讲/);
  assert.match(csv, /'@算法实习生/);

  // Markdown
  const md = exportLib.applicationsToMarkdown(rows, "全部已投递");
  assert.match(md, /全部已投递/);
  assert.match(md, /## 一、已投递企业汇总（2 家）/);
  assert.match(md, /## 二、已投递岗位明细（3 条）/);
  assert.match(md, /星河科技/);

  // XLSX: 2 worksheets readable back via ExcelJS
  const buf = await exportLib.applicationsToXlsxBuffer(rows);
  assert.equal(Buffer.isBuffer(buf), true);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const detailSheet = wb.getWorksheet("投递岗位明细");
  const companySheet = wb.getWorksheet("已投企业汇总");
  assert.ok(detailSheet, "detail sheet exists");
  assert.ok(companySheet, "company summary sheet exists");
  assert.equal(detailSheet.getRow(1).getCell(1).value, "企业名称");
  assert.equal(detailSheet.getRow(2).getCell(1).value, "星河科技");
  assert.equal(detailSheet.getRow(2).getCell(2).value, "'=HYPERLINK(\"http://evil\",\"数据分析师\")");
  assert.equal(companySheet.getRow(1).getCell(1).value, "企业名称");
  assert.equal(companySheet.rowCount, 3);
});

test("autofill-answer-scope enforces >= 8 maxLength when over limit and normalizes choice options", () => {
  assert.equal(answerScope.fitAnswerToLimit("同意接受公司安排", 2), "");
  assert.equal(answerScope.fitAnswerToLimit("123456789", 7), "");
  assert.equal(answerScope.fitAnswerToLimit("1234567", 7), "1234567");
  const trimmed = answerScope.fitAnswerToLimit("我具备扎实的统计学与数据分析能力。曾完成电商增长实验。", 18);
  assert.ok(trimmed.length > 0 && trimmed.length <= 18);
  assert.equal(answerScope.fitAnswerToLimit("   完全匹配   ", 20), "完全匹配");

  assert.equal(answerScope.matchChoiceOption("「硕士」", ["硕士", "博士"]), "硕士");
  assert.equal(answerScope.matchChoiceOption("ｙｅｓ", ["Yes", "No"]), "Yes");
  assert.equal(answerScope.matchChoiceOption("深圳", ["北京", "上海"]), null);

  assert.equal(answerScope.companySpecificQuestion("为什么选择加入本公司？"), true);
  assert.equal(answerScope.companySpecificQuestion("自我介绍"), false);
});

test("markTypedFileInputs and markResumeFileInputs handle shadowRoot, form-item labels, and uploaded state", () => {
  const makeNode = ({ tagName = "input", type = "text", id = "", name = "", accept = "", disabled = false, files = [], textContent = "", attrs = {}, parent = null, shadowRoot = null } = {}) => {
    const attrMap = new Map(Object.entries(attrs));
    const el = {
      tagName: tagName.toUpperCase(),
      type,
      id,
      name,
      disabled,
      files,
      textContent,
      parentElement: parent,
      shadowRoot,
      getAttribute: (k) => (k === "accept" ? accept : attrMap.get(k) ?? null),
      setAttribute: (k, v) => attrMap.set(k, String(v)),
      removeAttribute: (k) => attrMap.delete(k),
      hasAttribute: (k) => attrMap.has(k),
      getRootNode: () => doc,
      closest: (sel) => {
        const tokens = sel.split(",").map((s) => s.trim());
        for (let cur = el; cur; cur = cur.parentElement) {
          for (const t of tokens) {
            if (t.startsWith(".") && cur._classes?.includes(t.slice(1))) return cur;
            if (t.includes("form-item") && cur._classes?.some((c) => /form-item/i.test(c))) return cur;
            if (t.includes("upload") && cur._classes?.some((c) => /upload/i.test(c))) return cur;
          }
        }
        return null;
      },
      querySelector: (sel) => (sel.includes("done") ? el._doneNode || null : null),
      querySelectorAll: () => [],
    };
    return el;
  };

  const photoFormItem = makeNode({ tagName: "div", textContent: "个人证件照 点击上传附件" });
  photoFormItem._classes = ["ant-form-item"];
  const photoUploadWrap = makeNode({ tagName: "div", textContent: "点击上传附件", parent: photoFormItem });
  photoUploadWrap._classes = ["ant-upload"];
  const photoInput = makeNode({ type: "file", id: "photo", accept: ".jpg,.jpeg,.png", parent: photoUploadWrap });

  const doneFormItem = makeNode({ tagName: "div", textContent: "成绩单" });
  doneFormItem._classes = ["ant-form-item"];
  doneFormItem._doneNode = { ok: true };
  const doneInput = makeNode({ type: "file", id: "transcript-done", accept: ".pdf", parent: doneFormItem });

  const shadowHost = makeNode({ tagName: "div" });
  const shadowResume = makeNode({ type: "file", id: "shadow-cv", accept: ".pdf", attrs: { "aria-label": "上传个人简历" } });
  const shadowRoot = {
    querySelectorAll: (s) => (s === 'input[type="file"]' ? [shadowResume] : []),
    querySelector: () => null,
  };
  shadowHost.shadowRoot = shadowRoot;

  const doc = {
    querySelector: () => null,
    querySelectorAll: (s) => {
      if (s === 'input[type="file"]') return [photoInput, doneInput];
      if (s === "*") return [photoFormItem, photoUploadWrap, photoInput, doneFormItem, doneInput, shadowHost];
      return [];
    },
  };
  const CSS = { escape: (s) => s };

  const typed = vm.runInNewContext(`(${core.markTypedFileInputs.toString()})(["photo", "transcript"])`, { document: doc, CSS });
  assert.deepEqual([...typed], ["photo"]);
  assert.equal(photoInput.getAttribute("data-cp-upload-role"), "photo");
  assert.equal(doneInput.getAttribute("data-cp-upload-role"), null);

  const resumed = vm.runInNewContext(`(${core.markResumeFileInputs.toString()})()`, { document: doc, CSS });
  assert.equal(resumed, 1);
  assert.equal(shadowResume.getAttribute("data-cp-resume-upload"), "1");
});

test("fieldIdsInRect supports partial overlap, radio label rect fallback, and shadow DOM", () => {
  const CSS = { escape: (s) => s };
  const radioLabel = {
    getBoundingClientRect: () => ({ left: 50, top: 100, right: 120, bottom: 130, width: 70, height: 30 }),
  };
  const radioInput = {
    type: "radio",
    id: "r1",
    getAttribute: () => "cp-r1:0",
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    closest: () => radioLabel,
  };
  const edgeInput = {
    type: "text",
    id: "t1",
    getAttribute: () => "cp-t1",
    getBoundingClientRect: () => ({ left: 90, top: 105, right: 200, bottom: 125, width: 110, height: 20 }),
    closest: () => null,
  };
  const shadowInput = {
    type: "text",
    id: "s1",
    getAttribute: () => "cp-s1",
    getBoundingClientRect: () => ({ left: 60, top: 110, right: 110, bottom: 130, width: 50, height: 20 }),
    closest: () => null,
  };
  const shadowRoot = {
    querySelectorAll: (sel) => (sel === "[data-cp-fill-id]" ? [shadowInput] : []),
    querySelector: () => null,
  };
  const host = { shadowRoot };
  const doc = {
    querySelectorAll: (sel) => (sel === "[data-cp-fill-id]" ? [radioInput, edgeInput] : [host]),
    querySelector: () => null,
  };

  const ids = vm.runInNewContext(
    `(${core.fieldIdsInRect.toString()})({ x: 40, y: 95, width: 60, height: 35 })`,
    { document: doc, CSS },
  );
  assert.deepEqual([...ids].sort(), ["cp-r1", "cp-s1", "cp-t1"]);
});

test("BASIC_FIELD_RULES (最高学位/亲属在本公司), isThirdPartyField, and isOtherChoiceBox behave accurately", () => {
  const prof = { degree: "硕士", relativeInCompany: "无", name: "林晓舟" };
  assert.equal(core.matchBasicField({ label: "最高学位", options: ["学士", "硕士", "博士"] }, prof, new Map()), "硕士");
  assert.equal(core.matchBasicField({ label: "是否有亲属在本公司工作", options: ["是", "否"] }, prof, new Map()), "否");

  assert.equal(core.isThirdPartyField({ label: "是否有亲属在本公司工作", section: "基本信息" }), false);
  assert.equal(core.isThirdPartyField({ label: "紧急联系人姓名", section: "基本信息" }), true);
  assert.equal(core.isThirdPartyField({ label: "父亲姓名", section: "家庭成员" }), true);

  assert.equal(core.isOtherChoiceBox({ label: "其他学校" }), true);
  assert.equal(core.isOtherChoiceBox({ label: "其他专业2" }), true);
  assert.equal(core.isOtherChoiceBox({ label: "本科其他院校" }), true);
  assert.equal(core.isOtherChoiceBox({ label: "期望城市" }), false);
});

test("classifyRepeatBlocks aligns prefilled org variants using fuzzy normalization", () => {
  const fields = [
    { id: "e1-co", section: "实习经历", blockKey: "b1", label: "公司名称", hasValue: true, currentValue: "北京字节跳动科技有限公司" },
    { id: "e1-role", section: "实习经历", blockKey: "b1", label: "职位名称", hasValue: false, currentValue: "" },
    { id: "e2-co", section: "实习经历", blockKey: "b2", label: "公司名称", hasValue: false, currentValue: "" },
  ];
  const prof = {
    experiences: [
      { company: "美团", role: "产品实习生" },
      { company: "字节跳动", role: "数据分析实习生" },
    ],
  };
  const { repeats } = core.classifyRepeatBlocks(fields, prof);
  assert.equal(core.repeatFieldValue(fields[1], repeats.get("e1-role"), prof), "数据分析实习生");
  assert.equal(core.repeatFieldValue(fields[2], repeats.get("e2-co"), prof), "美团");
});

test("saveCorrectionsCore preserves existing fill IDs during background poll", async () => {
  const calls = [];
  const adapter = {
    taskId: "t1",
    url: () => "https://apply.example.com/form",
    frames: async () => [0],
    getDrafts: () => [],
    setDrafts: () => {},
    run: async (_frame, fn, args) => {
      calls.push({ fn: fn.name, args });
      if (fn === core.scanPageFields) return [{ id: "existing-1", label: "姓名", userEdited: true, hasValue: true }];
      if (fn === core.readFieldValues) return { "existing-1": { value: "新名字", userEdited: true } };
      return null;
    },
    api: async () => ({ ok: true, json: async () => ({ saved: 1, pending: 0 }) }),
  };
  await core.saveCorrectionsCore(adapter, "res-1", true);
  const scanCall = calls.find((c) => c.fn === "scanPageFields");
  assert.ok(scanCall, "scanPageFields was called");
  assert.equal(scanCall.args[2], true, "third arg preserveIds=true passed to scanPageFields");
});

test("applyAutofillPlan respects uploadAttachments=false and reports failed field labels", async () => {
  let attachmentCalls = 0;
  let resumeCalls = 0;
  let plan = null;
  const fields = [
    { id: "f1", mappingKey: "name", resultKey: "r1", label: "姓名", tag: "input", type: "text", hasValue: false },
    { id: "f2", mappingKey: "city", resultKey: "r2", label: "期望工作城市", tag: "select", options: ["北京", "上海"], hasValue: false },
  ];
  const adapter = {
    taskId: "t1",
    url: () => "https://apply.example.com/form",
    stillOnPage: () => true,
    frames: async () => [0],
    getPlan: () => plan,
    setPlan: (v) => { plan = v; },
    getDrafts: () => [],
    setDrafts: () => {},
    status: () => {},
    uploadResume: async () => { resumeCalls++; return 1; },
    uploadAttachments: async () => { attachmentCalls++; return { count: 0, labels: [] }; },
    api: async (name) => ({
      ok: true,
      json: async () => (name.startsWith("profile") ? { name: "林晓舟", preferredCities: "上海" } : {}),
    }),
    run: async (_frame, fn) => {
      if (fn === core.scanPageFields) return structuredClone(fields);
      if (fn === core.fillFields) return { filled: ["f1"], skipped: [], failed: ["期望工作城市"] };
      if (fn === core.validatePageFields) return [];
      return null;
    },
  };
  const preview = await core.runAutofillCore(adapter, "res-1", { mode: "preview", modules: ["basic", "resume"] });
  assert.equal(preview.phase, "preview");
  const res = await core.applyAutofillPlan(adapter, {
    planId: preview.plan.id,
    approved: [
      { id: "f1", value: "林晓舟" },
      { id: "f2", value: "上海" },
    ],
    uploadResume: false,
    uploadAttachments: false,
  });
  assert.equal(res.phase, "done");
  assert.equal(resumeCalls, 0);
  assert.equal(attachmentCalls, 0);
  assert.equal(res.summary.filled, 1);
  assert.equal(res.details.find((d) => d.label === "期望工作城市")?.source, "manual");
});

test("resetAutofillInFrame clears filled fields, supports keepUserEdited, and resets _valueTracker", () => {
  function HTMLInputElement() {}
  Object.defineProperty(HTMLInputElement.prototype, "value", {
    get() { return this._value; },
    set(v) { this._value = v; },
    configurable: true,
  });
  function HTMLTextAreaElement() {}
  Object.defineProperty(HTMLTextAreaElement.prototype, "value", {
    get() { return this._value; },
    set(v) { this._value = v; },
    configurable: true,
  });

  const mkControl = ({ tag, value = "", userEdited = false }) => {
    const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const attrs = new Map([["data-cp-filled", "profile"], ["data-cp-profile-filled", "1"]]);
    if (userEdited) attrs.set("data-cp-user-edited", "1");
    const events = [];
    const el = Object.create(proto);
    Object.assign(el, {
      tagName: tag.toUpperCase(),
      type: tag === "input" ? "text" : "",
      readOnly: false,
      _value: value,
      _trackerResetTo: null,
      _valueTracker: { setValue: (v) => { el._trackerResetTo = v; } },
      style: { removeProperty: () => {} },
      hasAttribute: (k) => attrs.has(k),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      dispatchEvent: (e) => { events.push(e.type); },
      querySelector: () => null,
      querySelectorAll: () => [],
      _events: events,
    });
    return el;
  };

  const a = mkControl({ tag: "input", value: "林晓舟", userEdited: false });
  const b = mkControl({ tag: "textarea", value: "手动改过的简介", userEdited: true });
  const doc = {
    querySelectorAll: (sel) => (sel.includes("data-cp-filled") ? [a, b] : []),
  };
  const win = { HTMLInputElement, HTMLTextAreaElement };

  const kept = vm.runInNewContext(
    `(${core.resetAutofillInFrame.toString()})(true)`,
    { document: doc, window: win, Event, InputEvent: undefined },
  );
  assert.equal(kept.cleared, 1);
  assert.equal(a._value, "");
  assert.equal(a._trackerResetTo, "林晓舟");
  assert.deepEqual(a._events, ["input", "change"]);
  assert.equal(b._value, "手动改过的简介");

  const full = vm.runInNewContext(
    `(${core.resetAutofillInFrame.toString()})(false)`,
    { document: doc, window: win, Event, InputEvent: undefined },
  );
  assert.equal(full.cleared, 1);
  assert.equal(b._value, "");
});

test("browser-view.js exposes allowBackground, newest-first attachment dedupe, and undo IPC", () => {
  const src = fs.readFileSync(path.join(__dirname, "../electron/browser-view.js"), "utf8");
  assert.match(src, /allowBackground:\s*true/);
  assert.match(src, /!byRole\.has\(item\.role\)/);
  assert.match(src, /browser:undo-autofill/);
  assert.match(src, /resetAutofillInFrame/);
});
