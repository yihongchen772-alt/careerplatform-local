const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { DatabaseSync } = require("node:sqlite");
const { PrismaClient } = require("@prisma/client");

const core = require("../electron/autofill-core.js");

function loadTs(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: mod.exports,
    module: mod,
    require: (id) => mocks[id] || (id.startsWith("@/") ? loadTs(`src/${id.slice(2)}.ts`, mocks) : require(id)),
    console,
    Date,
    Error,
    Buffer,
    URL,
    process,
    setTimeout,
    clearTimeout,
  });
  return mod.exports;
}

function loadBrowserViewTestHelpers() {
  const source = fs.readFileSync(path.join(__dirname, "../electron/browser-view.js"), "utf8");
  const context = vm.createContext({ module: { exports: {} }, URL, URLSearchParams, Buffer, setTimeout, clearTimeout, Date });
  const coreModule = { exports: {} };
  vm.runInContext(`(function (module, exports) {\n${fs.readFileSync(path.join(__dirname, "../electron/autofill-core.js"), "utf8")}\n})`, context)(coreModule, coreModule.exports);
  context.require = (name) =>
    name === "electron"
      ? {}
      : name === "./autofill-core.js"
        ? coreModule.exports
        : name.startsWith("./")
          ? require(path.join(__dirname, "../electron", name))
          : require(name);
  vm.runInContext(source, context);
  return context.module.exports.__test;
}

test("suggestValidationRepair deterministically repairs length, date, phone, and numeric/GPA errors", () => {
  const { suggestValidationRepair } = core;
  const tooLong = suggestValidationRepair(
    { label: "自我评价", tag: "textarea", type: "textarea", maxLength: 0 },
    { id: "q1", value: "熟悉后端高并发架构，具备丰富的分布式系统实战与调优经验。" },
    "网页提示：最多20个字符"
  );
  assert.ok(tooLong && tooLong.value.length <= 20);
  assert.equal(tooLong.value, "熟悉后端高并发架构");

  const uncuttableSingleSentence = suggestValidationRepair(
    { label: "自我评价", tag: "textarea", type: "textarea", maxLength: 0 },
    { id: "q2", value: "这是一段没有标点断句但超过二十字符限制的单个长句子" },
    "网页提示：最多20个字符"
  );
  assert.equal(uncuttableSingleSentence, null);

  const slashDate = suggestValidationRepair(
    { label: "入职时间", tag: "input", type: "text", placeholder: "YYYY/MM/DD" },
    { id: "d1", value: "2025-03-15" },
    "网页提示：格式错误"
  );
  assert.equal(slashDate?.value, "2025/03/15");

  const monthOnly = suggestValidationRepair(
    { label: "毕业年月", tag: "input", type: "text", placeholder: "YYYY-MM" },
    { id: "d2", value: "2025-06-30" },
    "网页提示：日期格式有误"
  );
  assert.equal(monthOnly?.value, "2025-06");

  const nativeDateSkipped = suggestValidationRepair(
    { label: "生日", tag: "input", type: "date" },
    { id: "d3", value: "2025-03-15" },
    "网页提示：格式不对"
  );
  assert.equal(nativeDateSkipped, null);

  const phone = suggestValidationRepair(
    { label: "手机号", tag: "input", type: "tel" },
    { id: "p1", value: "+86 138-0013-8000" },
    "网页提示：手机号格式不正确"
  );
  assert.equal(phone?.value, "13800138000");

  const gpa = suggestValidationRepair(
    { label: "成绩", tag: "input", type: "text" },
    { id: "g1", value: "3.85/4.0" },
    "网页提示：请输入纯数字"
  );
  assert.equal(gpa?.value, "3.85");

  const percent = suggestValidationRepair(
    { label: "排名", tag: "input", type: "number" },
    { id: "g2", value: "前5%" },
    "请输入数字"
  );
  assert.equal(percent?.value, "5");
});

test("validatePageFields reads modern framework errors without crashing on minimal DOM mocks", () => {
  const errNode = {
    textContent: "请输入正确日期格式 YYYY/MM/DD",
    querySelector: () => null,
    getClientRects: () => [{ width: 100, height: 18 }],
  };
  const group = {
    querySelectorAll: (sel) => (sel.includes("el-form-item__error") ? [errNode] : []),
  };
  const el = {
    tagName: "INPUT",
    type: "text",
    hidden: false,
    disabled: false,
    value: "2025-03-15",
    validity: { valid: true },
    getAttribute: (name) => (name === "data-cp-fill-id" ? "field-1" : null),
    getBoundingClientRect: () => ({ width: 200, height: 32 }),
    closest: (sel) => (sel.includes("el-form-item") ? group : null),
  };
  const fakeDoc = {
    querySelectorAll: (sel) => (sel === "[data-cp-fill-id]" ? [el] : []),
  };
  const issues = vm.runInNewContext(
    `(${core.validatePageFields.toString()})()`,
    { document: fakeDoc, Array, String, CSS: { escape: (s) => s } }
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, "field-1");
  assert.match(issues[0].message, /YYYY\/MM\/DD/);
});

test("fillFields only overwrites filled controls when retry is true and user did not manually edit", async () => {
  function makeInput({ value, filled, userEdited }) {
    const attrs = new Map();
    if (filled) attrs.set("data-cp-filled", "1");
    if (userEdited) attrs.set("data-cp-user-edited", "1");
    let currentValue = value;
    return {
      tagName: "INPUT",
      type: "text",
      disabled: false,
      readOnly: false,
      style: { setProperty() {} },
      dataset: {},
      closest: () => null,
      get _value() { return currentValue; },
      set _value(v) { currentValue = String(v); },
      get value() { return currentValue; },
      set value(v) { currentValue = String(v); },
      isContentEditable: false,
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: (k) => attrs.delete(k),
      dispatchEvent: () => true,
      focus: () => {},
      blur: () => {},
    };
  }

  const autofilled = makeInput({ value: "2025-03-15", filled: true, userEdited: false });
  const manualEdited = makeInput({ value: "2025-03-15", filled: true, userEdited: true });
  const fakeDoc = {
    querySelector: (sel) => {
      if (sel.includes('"f-auto"')) return autofilled;
      if (sel.includes('"f-user"')) return manualEdited;
      return null;
    },
  };
  const FakeInputCtor = function () {};
  Object.defineProperty(FakeInputCtor.prototype, "value", {
    get() { return this._value ?? ""; },
    set(v) { this._value = String(v); },
    configurable: true,
  });
  const FakeTextareaCtor = function () {};
  Object.defineProperty(FakeTextareaCtor.prototype, "value", {
    get() { return this._value ?? ""; },
    set(v) { this._value = String(v); },
    configurable: true,
  });
  const fakeWindow = {
    HTMLInputElement: FakeInputCtor,
    HTMLTextAreaElement: FakeTextareaCtor,
  };
  const res = await vm.runInNewContext(
    `(${core.fillFields.toString()})([
      { id: "f-auto", value: "2025/03/15", source: "rule", retry: true },
      { id: "f-user", value: "2025/03/15", source: "rule", retry: true }
    ])`,
    {
      document: fakeDoc,
      window: fakeWindow,
      Object,
      Promise,
      setTimeout,
      Event: function () {},
      InputEvent: function () {},
      KeyboardEvent: function () {},
      MouseEvent: function () {},
      FocusEvent: function () {},
      NodeList: Array,
      Array,
      String,
      Number,
      Set,
      CSS: { escape: (s) => s },
    }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(res.filled)), ["f-auto"]);
  assert.equal(autofilled.value, "2025/03/15");
  assert.equal(manualEdited.value, "2025-03-15");
});

test("screenshot-extract helpers normalize dates, URLs, stages, and company matching", () => {
  const {
    parseScreenshotExtraction,
    buildScreenshotMeetingInfo,
    resolveScreenshotTargetStage,
    matchApplicationForScreenshot,
  } = loadTs("src/lib/screenshot-extract.ts", {
    zod: require("zod"),
    "@/lib/ai-file-search": { SchemaType: { OBJECT: "OBJECT", STRING: "STRING", BOOLEAN: "BOOLEAN" } },
  });

  const parsed = parseScreenshotExtraction({
    kind: "interview",
    companyName: "示例科技",
    title: "2027 校招后端一面邀请",
    summary: "技术一面 45 分钟，请提前 10 分钟入会",
    startsAt: "2026-11-20T14:30:00+08:00",
    endsAt: "2026-11-20T15:15:00+08:00",
    hasTime: true,
    entryUrl: "https://meeting.example.test/join/998",
    accessCode: "998123",
    suggestedStage: "INTERVIEW_1",
  });
  assert.ok(parsed);
  assert.equal(parsed.companyName, "示例科技");
  assert.equal(parsed.hasTime, true);
  assert.equal(parsed.entryUrl, "https://meeting.example.test/join/998");
  assert.equal(parsed.startsAt, "2026-11-20T06:30:00.000Z");

  const unsafeUrl = parseScreenshotExtraction({
    kind: "exam",
    companyName: "",
    title: "在线笔试",
    summary: "请在 11 月 22 日前完成测评",
    startsAt: "2026-11-22",
    endsAt: "",
    hasTime: false,
    entryUrl: "javascript:alert(1)",
    accessCode: "",
    suggestedStage: null,
  });
  assert.ok(unsafeUrl);
  assert.equal(unsafeUrl.entryUrl, null);
  assert.equal(unsafeUrl.startsAt, "2026-11-22");
  assert.equal(unsafeUrl.hasTime, false);

  assert.equal(parseScreenshotExtraction("invalid"), null);
  assert.equal(parseScreenshotExtraction({ invalid: true })?.kind, "other");

  const info = buildScreenshotMeetingInfo(parsed);
  assert.match(info || "", /https:\/\/meeting\.example\.test\/join\/998/);
  assert.match(info || "", /口令\/编号：998123/);

  assert.equal(resolveScreenshotTargetStage("APPLIED", { kind: "exam", suggestedStage: null }), "OA");
  assert.equal(resolveScreenshotTargetStage("INTERVIEW_1", { kind: "interview", suggestedStage: null }), "INTERVIEW_2");
  assert.equal(resolveScreenshotTargetStage("APPLIED", { kind: "interview", suggestedStage: "INTERVIEW_3" }), "INTERVIEW_3");
  assert.equal(resolveScreenshotTargetStage("INTERVIEW_2", { kind: "offer", suggestedStage: null }), "OFFER");

  const apps = [
    { id: "a1", companyName: "字节跳动", label: "字节跳动 · 后端" },
    { id: "a2", companyName: "示例科技", label: "示例科技 · 研发" },
  ];
  assert.equal(matchApplicationForScreenshot(apps, "示例科技有限公司", "招募系统")?.id, "a2");
  assert.equal(matchApplicationForScreenshot(apps, null, "字节跳动校招官网 - 我的面试")?.id, "a1");
});

test("browser-view adaptive site strategy and login-gate cleared probe behave safely", () => {
  const { siteStrategyFor, detectLoginGateCleared } = loadBrowserViewTestHelpers();
  assert.deepEqual({ ...siteStrategyFor(null) }, { extraWaitMs: 0, preferAi: false, hint: null });
  assert.deepEqual({ ...siteStrategyFor({ fills: 3, filled: 18, manual: 2, errors: 0 }) }, { extraWaitMs: 0, preferAi: false, hint: null });

  const hardSite = siteStrategyFor({ fills: 3, filled: 2, manual: 10, errors: 0 });
  assert.equal(hardSite.extraWaitMs, 900);
  assert.equal(hardSite.preferAi, true);
  assert.match(hardSite.hint || "", /AI 辅助|框选填写/);

  const flakySite = siteStrategyFor({ fills: 1, filled: 5, manual: 1, errors: 2, lastError: "Navigation timed out" });
  assert.equal(flakySite.extraWaitMs, 900);
  assert.match(flakySite.hint || "", /Navigation timed out/);

  const withPasswordDoc = {
    body: { innerText: "" },
    querySelectorAll: (sel) => (sel.includes("password") ? [{ hidden: false, style: {}, getAttribute: () => null }] : []),
  };
  const stillLogin = detectLoginGateCleared(() => Array(10).fill({}), withPasswordDoc);
  assert.equal(stillLogin.hasPasswordInput, true);
  assert.equal(stillLogin.cleared, false);

  const otpWallDoc = {
    body: { innerText: "手机验证码登录 获取验证码" },
    querySelectorAll: (sel) => (sel === "input" ? [{ hidden: false, style: {}, placeholder: "请输入短信验证码", getAttribute: () => null }] : []),
  };
  const otpWall = detectLoginGateCleared(() => [{ id: "1" }], otpWallDoc);
  assert.equal(otpWall.looksLikeLoginWall, true);
  assert.equal(otpWall.cleared, false);

  const readyFormDoc = {
    body: { innerText: "基本信息 姓名 邮箱 教育经历" },
    querySelectorAll: () => [],
  };
  const cleared = detectLoginGateCleared(() => Array(6).fill({}), readyFormDoc);
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.fillable, 6);
});

test("syncOpenPortalPage saves portal, binds unassigned applications, and applies live page text", async (t) => {
  const base = path.resolve(__dirname, "../.local-run/phase1-sync-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const file = path.join(root, "test.db");
  const sql = new DatabaseSync(file);
  for (const name of fs.readdirSync(path.resolve(__dirname, "../prisma/migrations")).filter((s) => /^\d/.test(s)).sort()) {
    sql.exec(fs.readFileSync(path.resolve(__dirname, "../prisma/migrations", name, "migration.sql"), "utf8"));
  }
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
  t.after(async () => {
    await db.$disconnect();
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("unsafe cleanup");
    fs.rmSync(root, { recursive: true });
  });

  const day1 = new Date(Date.UTC(2026, 9, 1, 2));
  await db.user.create({ data: { id: "local-user", email: "fixture@local" } });
  await db.company.create({ data: { id: "co1", name: "星辰科技" } });
  await db.application.create({
    data: {
      id: "app1",
      userId: "local-user",
      companyId: "co1",
      title: "后端研发工程师",
      currentStage: "APPLIED",
      currentStageDate: day1,
      appliedDate: day1,
      stageHistory: { create: { stage: "APPLIED", enteredAt: day1 } },
    },
  });

  const sync = loadTs("src/lib/actions/application-sync.ts", {
    "@/lib/db": { db },
    "@/lib/session": { LOCAL_USER_ID: "local-user", requireUser: async () => ({ id: "local-user" }) },
    "next/cache": { revalidatePath() {} },
    "@/lib/ai-providers": {
      getUserAiConfig: async () => ({ provider: "fixture" }),
      callTextAi: async () => ({
        needsLogin: false,
        entries: [{ applicationId: "app1", portalStatus: "一面邀约中", stage: "INTERVIEW_1", confident: true }],
      }),
    },
    "@/lib/render-bridge-client": {
      renderPageText: async () => {
        throw new Error("should not call headless renderPageText for syncOpenPortalPage");
      },
    },
  });

  const res = await sync.syncOpenPortalPage({
    companyId: "co1",
    url: "https://jobs.xingchen.test/candidate/applications",
    pageText: "我的投递 后端研发工程师 当前状态：一面邀约中",
  });

  assert.equal(res.ok, true);
  assert.equal(res.data.companyName, "星辰科技");
  assert.equal(res.data.changes.length, 1);
  assert.equal(res.data.changes[0].to, "INTERVIEW_1");

  const updatedApp = await db.application.findUnique({ where: { id: "app1" } });
  assert.equal(updatedApp.currentStage, "INTERVIEW_1");
  assert.equal(updatedApp.portalStatus, "一面邀约中");
  assert.equal(updatedApp.portalId, res.data.portalId);
});
