const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const ts = require("typescript");

function loadTs(relPath, mocks = {}) {
  const fullPath = path.join(__dirname, "..", relPath);
  const src = fs.readFileSync(fullPath, "utf8");
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = { exports: {} };
  const requireFn = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(mocks, specifier)) return mocks[specifier];
    if (specifier.startsWith("@/")) {
      return loadTs(`src/${specifier.slice(2)}.ts`, mocks);
    }
    return require(specifier);
  };
  vm.runInNewContext(
    outputText,
    {
      module: mod,
      exports: mod.exports,
      require: requireFn,
      console,
      URL,
      URLSearchParams,
      Buffer,
      process,
      Request,
      Response,
      Headers,
      TextEncoder,
      ReadableStream,
      setTimeout,
      clearTimeout,
    },
    { filename: fullPath }
  );
  return mod.exports;
}

function loadElectronModule(relPath, mocks = {}) {
  const fullPath = path.join(__dirname, "..", relPath);
  const origLoad = Module._load;
  delete require.cache[fullPath];
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return origLoad.apply(this, arguments);
  };
  try {
    return require(fullPath);
  } finally {
    Module._load = origLoad;
  }
}

test("Phase 3A: extractOtpFromEmail & pickBestOtpCandidates parse codes, filter noise, and rank site matches", () => {
  const { extractOtpFromEmail, pickBestOtpCandidates } = loadTs("src/lib/email-otp.ts");
  const now = Date.UTC(2026, 10, 15, 10, 0, 0);

  const numeric = extractOtpFromEmail(
    {
      subject: "【星图智驾】邮箱登录验证码",
      from: "noreply@mokahr.com",
      date: new Date(now - 60_000),
      snippet: "您正在登录星图智驾校园招聘系统，本次验证码为 482910，10分钟内有效。联系电话 13812345678，面向2026届毕业生。",
    },
    { url: "https://jobs.mokahr.com/campus_apply/xingtu", companyName: "星图智驾", now }
  );
  assert.ok(numeric);
  assert.equal(numeric.code, "482910");
  assert.equal(numeric.matchedSite, true);

  const alpha = extractOtpFromEmail(
    {
      subject: "Verification code for login",
      from: "hr@example.com",
      date: new Date(now - 30_000),
      snippet: "Your one-time verification code: 7A3B9C. Please enter within 5 minutes.",
    },
    { url: "https://jobs.mokahr.com/campus_apply/xingtu", now }
  );
  assert.ok(alpha);
  assert.equal(alpha.code, "7A3B9C");
  assert.equal(alpha.matchedSite, false);

  const spaced = extractOtpFromEmail(
    {
      subject: "安全验证提醒",
      from: "security@beisen.com",
      date: new Date(now - 20_000),
      snippet: "您的动态码为 1 2 3 4 5 6，切勿泄露。",
    },
    { now }
  );
  assert.ok(spaced);
  assert.equal(spaced.code, "123456");

  const phoneAndYearOnly = extractOtpFromEmail(
    {
      subject: "2026届秋招验证码说明",
      from: "campus@demo.com",
      date: new Date(now - 10_000),
      snippet: "2026届校招验证码异常请致电 13912345678 咨询，无需输入2026届年份。",
    },
    { now }
  );
  assert.equal(phoneAndYearOnly, null);

  const graphicNoise = extractOtpFromEmail(
    {
      subject: "请输入图形验证码",
      from: "no-reply@site.com",
      date: new Date(now - 10_000),
      snippet: "请返回网页输入图形验证码 4829 以完成校验",
    },
    { now }
  );
  assert.equal(graphicNoise, null);

  const expired = extractOtpFromEmail(
    {
      subject: "验证码 998877",
      from: "noreply@mokahr.com",
      date: new Date(now - 20 * 60_000),
      snippet: "本次验证码：998877",
    },
    { now }
  );
  assert.equal(expired, null);

  const ranked = pickBestOtpCandidates(
    [
      {
        subject: "Other verification code 112233",
        from: "auth@other.com",
        date: new Date(now - 5_000),
        snippet: "Your code is 112233",
        accountLabel: "个人QQ邮箱",
      },
      {
        subject: "星图智驾 Moka 登录验证码",
        from: "noreply@mokahr.com",
        date: new Date(now - 90_000),
        snippet: "您的登录验证码是 654321，5分钟内有效。",
        accountLabel: "校招专用邮箱",
      },
    ],
    { url: "https://jobs.mokahr.com/campus_apply/xingtu", companyName: "星图智驾", now }
  );
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].code, "654321");
  assert.equal(ranked[0].matchedSite, true);
  assert.equal(ranked[0].accountLabel, "校招专用邮箱");
});

test("Phase 3A: /api/desktop-browser/email-otp handles empty accounts and partial mailbox failures", async () => {
  let accounts = [];
  const nextServerMock = {
    NextResponse: {
      json: (body, init) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
  };

  const makeRoute = (fetchFn) =>
    loadTs("src/app/api/desktop-browser/email-otp/route.ts", {
      "next/server": nextServerMock,
      "@/lib/session": { requireUser: async () => ({ id: "u1" }) },
      "@/lib/imap": {
        getUserScanAccounts: async () => accounts,
        fetchLatestEmailsForOtp: fetchFn,
      },
    });

  const emptyRoute = makeRoute(async () => []);
  const emptyRes = await emptyRoute.POST(new Request("http://localhost/api/desktop-browser/email-otp", { method: "POST", body: "{}" }));
  const emptyJson = await emptyRes.json();
  assert.equal(emptyRes.status, 200);
  assert.equal(emptyJson.available, false);
  assert.deepEqual(emptyJson.candidates, []);

  accounts = [
    { id: "a1", label: "故障邮箱" },
    { id: "a2", label: "主邮箱" },
  ];
  const now = new Date();
  const workingRoute = makeRoute(async (acc) => {
    if (acc.id === "a1") throw new Error("IMAP timeout");
    return [
      {
        uid: 101,
        subject: "【飞书招聘】登录验证码",
        from: "verify@feishu.cn",
        date: now,
        snippet: "您正在验证邮箱，验证码：518290（10分钟内有效）",
      },
    ];
  });
  const okRes = await workingRoute.POST(
    new Request("http://localhost/api/desktop-browser/email-otp", {
      method: "POST",
      body: JSON.stringify({ url: "https://jobs.feishu.cn/campus/login", title: "飞书登录" }),
    })
  );
  const okJson = await okRes.json();
  assert.equal(okRes.status, 200);
  assert.equal(okJson.available, true);
  assert.equal(okJson.checkedAccounts, 2);
  assert.equal(okJson.errorAccounts, 1);
  assert.equal(okJson.candidates[0].code, "518290");
  assert.equal(okJson.candidates[0].accountLabel, "主邮箱");
  assert.equal(okJson.candidates[0].matchedSite, true);
});

test("Phase 3A: browser-view OTP IPC and fillOtpInPage fill both segmented and single inputs while ignoring graphic captchas", async () => {
  const handles = new Map();
  const onHandlers = new Map();
  const sentToHost = [];
  const executedScripts = [];

  const fakeWc = {
    getURL: () => "https://jobs.mokahr.com/login",
    getTitle: () => "Moka 登录",
    isLoading: () => false,
    isDestroyed: () => false,
    sendInputEvent: () => {},
    executeJavaScript: async (code) => {
      executedScripts.push(code);
      if (code.includes("fillOtpInPage")) return { filled: true, segmented: true };
      return null;
    },
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
      getAllEntries: () => [{ url: "https://jobs.mokahr.com/login", title: "Moka 登录" }],
      getActiveIndex: () => 0,
    },
    getZoomFactor: () => 1,
    setZoomFactor: () => {},
    setWindowOpenHandler: () => {},
    loadURL: () => {},
    stop: () => {},
    close: () => {},
    on: () => {},
    once: () => {},
  };
  const wcFrame = {
    url: "https://jobs.mokahr.com/login",
    executeJavaScript: fakeWc.executeJavaScript,
    framesInSubtree: [],
  };
  wcFrame.framesInSubtree = [wcFrame];
  fakeWc.mainFrame = wcFrame;

  const fakeFrame = { url: "http://localhost:3000/browser" };
  const fakeWin = {
    isDestroyed: () => false,
    webContents: {
      id: 1,
      send: (ch, data) => sentToHost.push({ ch, data }),
      isDestroyed: () => false,
      getURL: () => "http://localhost:3000/browser",
      mainFrame: fakeFrame,
    },
    contentView: { addChildView: () => {}, removeChildView: () => {} },
  };
  const trustedEvent = { sender: fakeWin.webContents, senderFrame: fakeFrame };

  const browserViewMod = loadElectronModule("electron/browser-view.js", {
    electron: {
      app: { getPath: () => "/tmp" },
      session: {
        fromPartition: () => ({ on: () => {}, clearStorageData: async () => {}, setUserAgent: () => {} }),
      },
      ipcMain: {
        handle: (ch, fn) => handles.set(ch, fn),
        on: (ch, fn) => onHandlers.set(ch, fn),
        removeHandler: () => {},
      },
      clipboard: { readText: () => "" },
      WebContentsView: function () {
        return { webContents: fakeWc, setBounds: () => {}, setBackgroundColor: () => {} };
      },
      Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    },
  });

  browserViewMod.setupBrowserViewIpc(fakeWin, 3000);
  const tabId = await handles.get("browser:new-tab")(trustedEvent, "https://jobs.mokahr.com/login");

  const guestOtpListener = onHandlers.get("browser-guest:otp-form");
  assert.equal(typeof guestOtpListener, "function");
  guestOtpListener({ sender: fakeWc }, { visible: true, emailLikely: true });

  const otpState = await handles.get("browser:otp-state")(trustedEvent, tabId);
  assert.deepEqual(otpState, { visible: true, emailLikely: true });
  assert.ok(sentToHost.some((msg) => msg.ch === "browser:otp-state" && msg.data.state?.emailLikely === true));

  const fillRes = await handles.get("browser:fill-otp")(trustedEvent, " 482910 ", tabId);
  assert.deepEqual(fillRes, { filled: true, segmented: true });
  assert.equal(await handles.get("browser:otp-state")(trustedEvent, tabId), null);

  // Extract and execute the real fillOtpInPage DOM helper against both segmented and single inputs.
  const bvSource = fs.readFileSync(path.join(__dirname, "..", "electron/browser-view.js"), "utf8");
  const start = bvSource.indexOf("function fillOtpInPage(rawCode)");
  const end = bvSource.indexOf("\nlet batchQueueToken");
  assert.ok(start > 0 && end > start);
  const fillOtpSource = bvSource.slice(start, end);

  const runFillInFakeDom = (inputs, code) => {
    const dispatched = [];
    const ctx = {
      HTMLInputElement: function () {},
      Event: function (type, opts) {
        this.type = type;
        this.bubbles = !!opts?.bubbles;
      },
      getComputedStyle: () => ({ visibility: "visible" }),
      document: {
        activeElement: null,
        querySelectorAll: () => inputs,
      },
    };
    Object.defineProperty(ctx.HTMLInputElement.prototype, "value", {
      configurable: true,
      get() {
        return this._val || "";
      },
      set(v) {
        this._val = v;
      },
    });
    for (const inp of inputs) {
      delete inp.value;
      Object.setPrototypeOf(inp, ctx.HTMLInputElement.prototype);
      inp.focus = () => {
        ctx.document.activeElement = inp;
      };
      inp.blur = () => {};
      inp.dispatchEvent = (ev) => dispatched.push({ id: inp.id, type: ev.type, val: inp.value });
      inp.getClientRects = () => [{}];
      inp.getAttribute = (k) => inp.attrs?.[k] ?? null;
      inp.closest = () => inp.rowWrap ?? null;
      inp.style = {};
    }
    return {
      result: vm.runInNewContext(`(${fillOtpSource})(${JSON.stringify(code)})`, ctx),
      dispatched,
    };
  };

  // Segmented 6-box test
  const segWrap = { innerText: "请输入邮箱验证码" };
  const segInputs = Array.from({ length: 6 }, (_, i) => ({
    id: `seg_${i}`,
    maxLength: 1,
    value: "",
    attrs: { type: "text" },
    parentElement: segWrap,
  }));
  const segOut = runFillInFakeDom(segInputs, "654321");
  assert.deepEqual(JSON.parse(JSON.stringify(segOut.result)), { filled: true, segmented: true });
  assert.deepEqual(
    segInputs.map((x) => x.value),
    ["6", "5", "4", "3", "2", "1"]
  );

  // Single-input test: graphic captcha must be skipped in favor of email OTP box
  const graphicInput = {
    id: "img_cap",
    name: "captcha",
    placeholder: "请输入图形验证码",
    maxLength: 4,
    value: "",
    attrs: { type: "text" },
    rowWrap: { innerText: "图形验证码" },
  };
  const emailOtpInput = {
    id: "email_otp",
    name: "emailCode",
    placeholder: "请输入邮箱验证码",
    maxLength: 6,
    value: "",
    attrs: { type: "text", autocomplete: "one-time-code" },
    rowWrap: { innerText: "邮箱验证码 发送验证码" },
  };
  const singleOut = runFillInFakeDom([graphicInput, emailOtpInput], "482910");
  assert.deepEqual(JSON.parse(JSON.stringify(singleOut.result)), { filled: true, segmented: false });
  assert.equal(graphicInput.value, "");
  assert.equal(emailOtpInput.value, "482910");

  // Guest preload detector string check
  const preloadSrc = fs.readFileSync(path.join(__dirname, "..", "electron/browser-guest-preload.js"), "utf8");
  assert.match(preloadSrc, /detectOtpBox/);
  assert.match(preloadSrc, /browser-guest:otp-form/);

  await handles.get("browser:close-tab")(trustedEvent, tabId);
});

test("Phase 3B: ats-family classifies Chinese/global ATS vendors and limits cross-tenant fallback to safe scalar refs", () => {
  const { atsFamilyFor, mergeMappingsWithAtsFallback } = loadTs("src/lib/ats-family.ts");

  assert.equal(atsFamilyFor("https://jobs.mokahr.com/campus_apply/acme/123"), "moka");
  assert.equal(atsFamilyFor("page:v2:https://acme.zhiye.com/campus"), "beisen");
  assert.equal(atsFamilyFor("https://hr.italent.cn/apply"), "beisen");
  assert.equal(atsFamilyFor("https://jobs.bytedance.com/campus/position"), "feishu");
  assert.equal(atsFamilyFor("https://demo.hotjob.cn/SU/campus"), "dayee");
  assert.equal(atsFamilyFor("ats:v1:moka"), "moka");
  assert.equal(atsFamilyFor("https://career.unknown-company.cn/apply"), null);

  const merged = mergeMappingsWithAtsFallback(
    [
      // Old mapping on Company A Moka portal (safe scalar + sensitive scalar + row ref)
      { contextKey: "job:v1:pos_a", fieldKey: "avail_q", ref: "availableFrom", atsFamily: "moka" },
      { contextKey: "job:v1:pos_a", fieldKey: "phone_q", ref: "phone", atsFamily: "moka" },
      { contextKey: "job:v1:pos_a", fieldKey: "edu_q", ref: "row:education:0:school", atsFamily: "moka" },
      // Newer mapping on same ATS family overrides old one
      { contextKey: "page:v2:https://other.mokahr.com/apply", fieldKey: "avail_q", ref: "expectedSalary" },
      // Different ATS family (Beisen) must not leak into Moka
      { contextKey: "https://other.beisen.com/apply", fieldKey: "research_q", ref: "researchDirection", atsFamily: "beisen" },
      // Exact mapping on target portal must win over inherited fallback
      { contextKey: "job:v1:pos_b", fieldKey: "exact_q", ref: "currentCity" },
      { contextKey: "job:v1:pos_a", fieldKey: "exact_q", ref: "hometown", atsFamily: "moka" },
    ],
    "job:v1:pos_b",
    "https://target.mokahr.com/campus_apply/pos_b"
  );

  const byKey = Object.fromEntries(merged.map((m) => [m.fieldKey, m]));
  assert.equal(byKey.exact_q.ref, "currentCity");
  assert.equal(byKey.exact_q.inheritedFromFamily, undefined);
  assert.equal(byKey.avail_q.ref, "expectedSalary");
  assert.equal(byKey.avail_q.inheritedFromFamily, "moka");
  assert.equal(byKey.phone_q, undefined);
  assert.equal(byKey.edu_q, undefined);
  assert.equal(byKey.research_q, undefined);
});

test("Phase 3B: field-mapping saves atsFamily and profile inherits cross-tenant safe mappings via url", async () => {
  let savedMappings = [];
  const fakeDb = {
    $transaction: async (fn) =>
      fn({
        user: {
          findUniqueOrThrow: async () => ({ autofillMappings: savedMappings }),
          update: async ({ data }) => {
            savedMappings = data.autofillMappings;
          },
        },
      }),
    user: {},
    autofillAnswer: { findMany: async () => [] },
    applicationMemory: { findMany: async () => [] },
    position: { findFirst: async () => ({ title: "算法工程师" }) },
  };
  const nextServerMock = {
    NextResponse: {
      json: (body, init) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        }),
    },
  };
  const mocks = {
    "next/server": nextServerMock,
    "@/lib/db": { db: fakeDb },
    "@/lib/session": { requireUser: async () => ({ id: "u1" }) },
  };

  const { POST } = loadTs("src/app/api/desktop-browser/field-mapping/route.ts", mocks);
  const saveRes = await POST(
    new Request("http://localhost/api/desktop-browser/field-mapping", {
      method: "POST",
      body: JSON.stringify({
        contextKey: "job:v1:pos_a",
        url: "https://compa.mokahr.com/campus_apply/a",
        mappings: [
          { fieldKey: "custom_avail", ref: "availableFrom" },
          { fieldKey: "custom_phone", ref: "phone" },
        ],
      }),
    })
  );
  assert.equal(saveRes.status, 200);
  assert.equal(savedMappings.length, 2);
  assert.equal(savedMappings[0].atsFamily, "moka");

  const userObj = {
    id: "u1",
    name: "张测试",
    phone: "13800001111",
    email: "me@local",
    contactEmail: "test@example.com",
    gender: "男",
    birthDate: "2001-01-01",
    school: "测试大学",
    targetTrack: "AI",
    graduationYear: 2026,
    preferredCities: "上海",
    applicationProfile: { extras: { availableFrom: "随时到岗" } },
    autofillMappings: savedMappings,
  };
  fakeDb.user.findUniqueOrThrow = async () => userObj;
  const { GET } = loadTs("src/app/api/desktop-browser/profile/route.ts", {
    ...mocks,
    "@/lib/session": { requireUser: async () => userObj },
  });
  const profRes = await GET(
    new Request(
      "http://localhost/api/desktop-browser/profile?contextKey=job%3Av1%3Apos_b&url=https%3A%2F%2Fcompb.mokahr.com%2Fcampus_apply%2Fb"
    )
  );
  assert.equal(profRes.status, 200);
  const profJson = await profRes.json();
  assert.equal(profJson.atsFamily, "moka");
  assert.equal(profJson.mappings.length, 1);
  assert.equal(profJson.mappings[0].fieldKey, "custom_avail");
  assert.equal(profJson.mappings[0].inheritedFromFamily, "moka");
});

test("Phase 3B: answer-questions prompt prevents cross-field essay repetition on multi-question pages", async () => {
  const capturedPrompts = [];
  const fakeDb = {
    user: { findUnique: async () => ({ name: "测试同学", graduationYear: 2026 }) },
    applicationProfile: { findUnique: async () => ({ resumeVersionId: "rv_1", parsedProfile: {} }) },
    resumeVersion: { findFirst: async () => ({ id: "rv_1", name: "简历", fileUrl: "/r.pdf", extractedText: "多模态与强化学习项目" }) },
    position: { findFirst: async () => ({ id: "p1", title: "算法工程师", jdText: "负责多模态算法与仿真验证", company: { name: "星图智驾" } }) },
    autofillAnswer: { findMany: async () => [], findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
    application: { findFirst: async () => null },
  };
  const { POST } = loadTs("src/app/api/desktop-browser/answer-questions/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init) =>
          new Response(JSON.stringify(body), { status: init?.status || 200, headers: { "Content-Type": "application/json" } }),
      },
    },
    "@/lib/db": { db: fakeDb },
    "@/lib/session": { requireUser: async () => ({ id: "u1" }) },
    "@/lib/gemini": { fetchFileAsInlinePart: async () => null },
    "@/lib/ai-file-search": {
      getFileSearchKey: async () => null,
      getImageSearchKey: async () => null,
      generateStructuredWithFile: async () => null,
    },
    "@/lib/ai-providers": {
      getUserAiConfig: async () => ({ provider: "openai", model: "gpt-4o-mini", apiKey: "test-key" }),
      callTextAi: async ({ prompt }) => {
        capturedPrompts.push(prompt);
        return {
          answers: [
            { id: "q2", answer: "我在校内完成了另一个强化学习路径规划与仿真评估项目。" },
          ],
        };
      },
    },
    "@/lib/resume-extract": { extractResumeContent: async () => ({ text: "多模态与强化学习项目" }) },
    "@/lib/autofill-answer-scope": {
      companySpecificQuestion: () => true,
      fitAnswerToLimit: (v) => v,
      matchChoiceOption: () => null,
    },
    "@/lib/autofill-cache": {
      cacheQuestionKey: (q) => q.label,
      cachedAnswerUsable: (hit, q) => (q.id === "q1" && hit?.questionLabel === q.label ? hit.answer : null),
      hasQuestionHint: () => false,
    },
  });
  fakeDb.autofillAnswer.findMany = async () => [
    {
      id: "ans_1",
      kind: "essay",
      confirmed: true,
      questionLabel: "最自豪的研究项目",
      answer: "在多模态视觉感知项目中，我主导设计了跨模态注意力对齐模块，使离线评测准确率提升显著并完成实车验证。",
      contextKey: "job:v1:p1",
    },
  ];

  const res = await POST(
    new Request("http://localhost/api/desktop-browser/answer-questions", {
      method: "POST",
      body: JSON.stringify({
        resumeVersionId: "rv_1",
        positionId: "p1",
        contextKey: "job:v1:p1",
        questions: [
          { id: "q1", label: "最自豪的研究项目", kind: "essay" },
          { id: "q2", label: "最有挑战的技术难题及解决过程", kind: "essay" },
        ],
      }),
    })
  );
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.answers.length, 2);
  assert.equal(capturedPrompts.length, 1);
  assert.match(capturedPrompts[0], /同页有多个开放题时，每道题紧扣各自题干切入/);
  assert.match(capturedPrompts[0], /同页已有其余题目的回答摘要/);
  assert.match(capturedPrompts[0], /最自豪的研究项目：在多模态视觉感知项目中/);
});

test("Phase 3B: /api/desktop-browser/pending-changes returns structured pending payload", async () => {
  const fakeDb = {
    autofillAnswer: {
      findMany: async () => [
        {
          id: "ans_1",
          questionLabel: "期望工作城市",
          answer: "上海",
          kind: "field",
          contextKey: null,
          updatedAt: new Date("2026-11-10T08:00:00Z"),
        },
      ],
    },
    applicationMemory: { findMany: async () => [] },
    user: { findUniqueOrThrow: async () => ({ applicationProfile: { extras: { hometown: "杭州" } }, preferredCities: "上海" }) },
    position: { findMany: async () => [{ id: "pos_1", title: "算法工程师", company: { name: "星图智驾" } }] },
  };
  const pendingRows = [
    {
      id: "pend_1",
      kind: "answer",
      sourceUrl: "https://jobs.mokahr.com/campus_apply/xingtu",
      contextKey: "job:v1:pos_1",
      payload: { questionLabel: "研究方向", answer: "具身智能与视觉语言模型", kind: "essay" },
    },
  ];

  const { GET } = loadTs("src/app/api/desktop-browser/pending-changes/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init) =>
          new Response(JSON.stringify(body), { status: init?.status || 200, headers: { "Content-Type": "application/json" } }),
      },
    },
    "@/lib/db": { db: fakeDb },
    "@/lib/session": { requireUser: async () => ({ id: "u1" }) },
    "@/lib/pending-application-change": {
      loadVisiblePending: async () => pendingRows,
      toPendingApplicationChangeView: (row) => ({ ...row, summary: "研究方向" }),
    },
  });

  const res = await GET();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.total, 1);
  assert.equal(data.items[0].id, "pend_1");
  assert.equal(data.sources["job:v1:pos_1"], "星图智驾 · 算法工程师");
  assert.equal(data.currentAnswers[0].updatedAt, "2026-11-10T08:00:00.000Z");
  assert.equal(data.profileValues.hometown, "杭州");
  assert.equal(data.profileValues.preferredCities, "上海");
});
