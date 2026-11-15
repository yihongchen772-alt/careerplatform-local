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
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return origLoad.apply(this, arguments);
  };
  try {
    return require(fullPath);
  } finally {
    Module._load = origLoad;
  }
}

test("Phase 2B: recommendSetupForPage matches tailored site resume and domain clusters", () => {
  const { recommendSetupForPage } = loadTs("src/lib/browser-intelligence.ts");

  const tailored = recommendSetupForPage({
    url: "https://jobs.bytedance.com/campus/position/123",
    tailoredResumes: [{ resumeVersionId: "rv_algo", name: "ByteDance_Algo.pdf", label: "字节 · 算法实习生", site: "bytedance.com" }],
    resumeVersions: [
      { id: "rv_default", name: "通用后端简历.pdf", isDefault: true, digest: "Java Go MySQL" },
      { id: "rv_algo", name: "ByteDance_Algo.pdf", isDefault: false, digest: "PyTorch LLM" },
    ],
    profileVariants: [
      { id: "var_be", name: "后端通用资料", resumeVersionId: "rv_default" },
      { id: "var_algo", name: "大模型算法资料", resumeVersionId: "rv_algo" },
    ],
    currentResumeVersionId: "rv_default",
    currentVariantChoice: "default",
  });
  assert.ok(tailored);
  assert.equal(tailored.resumeVersionId, "rv_algo");
  assert.equal(tailored.variantId, "var_algo");
  assert.match(tailored.reason, /定制简历/);

  const semantic = recommendSetupForPage({
    url: "https://app.mokahr.com/campus-recruitment/galbot/123",
    jdTitle: "具身智能算法实习生",
    jdText: "负责 VLA 多模态模型、ROS2 与机械臂运动控制训练，熟练使用 PyTorch / Isaac Gym。",
    tailoredResumes: [],
    resumeVersions: [
      { id: "rv_fe", name: "前端工程简历.pdf", isDefault: true, digest: "React TypeScript Next.js CSS" },
      { id: "rv_emb", name: "具身智能与机器人算法简历.pdf", isDefault: false, digest: "PyTorch VLA ROS2 机械臂 SLAM" },
    ],
    profileVariants: [
      { id: "var_fe", name: "前端投递版本", resumeVersionId: "rv_fe" },
      { id: "var_emb", name: "具身智能机器人方向", resumeVersionId: "rv_emb" },
    ],
    currentResumeVersionId: "rv_fe",
    currentVariantChoice: "var_fe",
  });
  assert.ok(semantic);
  assert.equal(semantic.resumeVersionId, "rv_emb");
  assert.equal(semantic.variantId, "var_emb");
  assert.match(semantic.reason, /具身智能|大模型/);

  const alreadyBest = recommendSetupForPage({
    url: "https://app.mokahr.com/campus-recruitment/galbot/123",
    jdTitle: "具身智能算法实习生",
    jdText: "PyTorch VLA ROS2",
    tailoredResumes: [],
    resumeVersions: [
      { id: "rv_fe", name: "前端工程简历.pdf", isDefault: true, digest: "React" },
      { id: "rv_emb", name: "具身智能与机器人算法简历.pdf", isDefault: false, digest: "PyTorch VLA ROS2" },
    ],
    profileVariants: [{ id: "var_emb", name: "具身智能机器人方向", resumeVersionId: "rv_emb" }],
    currentResumeVersionId: "rv_emb",
    currentVariantChoice: "var_emb",
  });
  assert.equal(alreadyBest, null);
});

test("Phase 2B: analyzeEligibilityAndQuota detects cohort, degree, quota, and duplicate warnings", () => {
  const { analyzeEligibilityAndQuota } = loadTs("src/lib/browser-intelligence.ts");

  const flagged = analyzeEligibilityAndQuota({
    profile: { graduationYear: 2027, degree: "本科" },
    companyName: "星海图",
    applications: [
      { id: "a1", companyName: "星海图科技有限公司", title: "具身算法实习生", stage: "笔试中", terminal: false },
      { id: "a2", companyName: "星海图", title: "仿真开发实习生", stage: "投递中", terminal: false },
      { id: "a3", companyName: "星海图", title: "旧岗位", stage: "已结束", terminal: true },
    ],
    position: {
      title: "具身算法实习生",
      companyName: "星海图",
      applicationRules: "2026届校园招聘：要求硕士及以上学历，每人最多投递 2 个岗位。",
      jdText: "面向2026届毕业生",
    },
  });

  const kinds = [...flagged.warnings.map((w) => w.kind)].sort();
  assert.deepEqual(kinds, ["degree", "duplicate", "graduation", "quota"]);

  const socialRecruit = analyzeEligibilityAndQuota({
    profile: { graduationYear: 2027, degree: "硕士" },
    companyName: "星海图",
    applications: [],
    jdPage: { title: "资深架构师", text: "社会招聘，欢迎2023届及以前毕业生，本科及以上学历。" },
  });
  assert.equal(socialRecruit.warnings.length, 0);
});

test("Phase 2A: save-ai-draft persists confirmed drafts and filters sensitive values", async () => {
  const created = [];
  const updated = [];
  const existingRows = [
    {
      id: "ans_existing",
      questionLabel: "基本资料 · 期望城市",
      answer: "北京",
      confirmed: false,
      kind: "short",
      contextKey: "job:v1:pos_1",
      updatedAt: new Date(),
    },
  ];
  const fakeDb = {
    position: { findFirst: async ({ where }) => (where.id === "pos_1" && where.userId === "u1" ? { id: "pos_1" } : null) },
    resumeVersion: { findFirst: async ({ where }) => (where.id === "rv_1" && where.userId === "u1" ? { id: "rv_1" } : null) },
    autofillAnswer: {
      findMany: async () => existingRows,
      update: async (args) => updated.push(args),
      create: async (args) => created.push(args),
    },
  };
  const { POST } = loadTs("src/app/api/desktop-browser/save-ai-draft/route.ts", {
    "@/lib/db": { db: fakeDb },
    "@/lib/session": { requireUser: async () => ({ id: "u1" }) },
  });

  const req = new Request("http://localhost/api/desktop-browser/save-ai-draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: "https://app.mokahr.com/campus_apply/demo?utm_source=x#top",
      positionId: "pos_1",
      resumeVersionId: "rv_1",
      items: [
        { label: "期望城市", value: "上海", section: "基本资料" },
        {
          label: "为什么投递本岗位",
          value: "我在研究生期间深入参与了多模态大模型训练与具身机器人控制项目，与贵团队的技术路线高度契合，也具备完整的真机部署、仿真验证与系统联调落地经验。",
          section: "开放问答",
        },
        { label: "身份证号", value: "110101200001011234" },
        { label: "登录密码", value: "secret123" },
        { label: "备注", value: "11010120000101123X" },
      ],
    }),
  });
  const res = await POST(req);
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.saved, 2);
  assert.equal(updated.length, 1);
  assert.equal(updated[0].where.id, "ans_existing");
  assert.equal(updated[0].data.answer, "上海");
  assert.equal(updated[0].data.confirmed, true);
  assert.equal(created.length, 1);
  assert.equal(created[0].data.questionLabel, "开放问答 · 为什么投递本岗位");
  assert.equal(created[0].data.kind, "essay");
  assert.equal(created[0].data.contextKey, "job:v1:pos_1");

  const missingPos = await POST(
    new Request("http://localhost/api/desktop-browser/save-ai-draft", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com", positionId: "bad_pos", items: [{ label: "a", value: "b" }] }),
    })
  );
  assert.equal(missingPos.status, 404);
});

test("Phase 2B: answer-questions falls back to unbound jdContext in LLM prompt and cache digest", async () => {
  const capturedPrompts = [];
  const fakeDb = {
    user: { findUnique: async () => ({ name: "测试同学", graduationYear: 2026 }) },
    applicationProfile: { findUnique: async () => ({ resumeVersionId: "rv_1", parsedProfile: { skills: ["PyTorch", "ROS2"] } }) },
    resumeVersion: { findFirst: async () => ({ id: "rv_1", name: "算法简历", fileUrl: "/r.pdf", extractedText: "PyTorch 具身智能项目" }) },
    position: { findFirst: async () => null },
    autofillAnswer: { findMany: async () => [], findFirst: async () => null, create: async () => ({}), update: async () => ({}) },
    application: { findFirst: async () => null },
  };
  const { POST } = loadTs("src/app/api/desktop-browser/answer-questions/route.ts", {
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
        return { answers: [{ id: "q1", answer: "我在校期间主导了 ROS2 机械臂项目。" }] };
      },
    },
    "@/lib/resume-extract": {
      extractResumeContent: async () => ({ text: "PyTorch 具身智能项目" }),
    },
    "@/lib/autofill-answer-scope": {
      companySpecificQuestion: () => true,
      fitAnswerToLimit: (v) => v,
      matchChoiceOption: () => null,
    },
  });

  const req = new Request("http://localhost/api/desktop-browser/answer-questions", {
    method: "POST",
    body: JSON.stringify({
      url: "https://jobs.example.com/apply/1",
      resumeVersionId: "rv_1",
      questions: [{ id: "q1", label: "为什么选择我们的机器人算法岗位？", maxLength: 150 }],
      jdContext: {
        title: "具身机器人算法实习生",
        url: "https://jobs.example.com/jd/1",
        text: "负责机械臂控制、VLA 模型部署与仿真验证。",
      },
    }),
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.answers.length, 1);
  assert.equal(capturedPrompts.length, 1);
  assert.match(capturedPrompts[0], /当前浏览的关联岗位页（未绑定候选池/);
  assert.match(capturedPrompts[0], /具身机器人算法实习生/);
  assert.match(capturedPrompts[0], /VLA 模型部署与仿真验证/);
});

test("Phase 2A: agent route injects form schema & sync_current_portal_page tool", async () => {
  const capturedRunArgs = [];
  let syncInvokedWith = null;
  const { POST } = loadTs("src/app/api/agent/route.ts", {
    "@/lib/session": { requireUser: async () => ({ id: "u1", name: "测试" }) },
    "@/lib/agent/config": { getAgentConfig: async () => ({ provider: "gemini", model: "gemini-2.5-flash" }) },
    "@/lib/action-result": { UserFacingError: class UserFacingError extends Error {} },
    "@/lib/assistant-context": { MAX_HISTORY_TURNS: 8 },
    "@/lib/agent/llm": {
      createChat: () => async () => ({}),
      historyMessages: () => [],
      summarizeDroppedHistory: () => "",
    },
    "@/lib/agent/run": {
      runAgent: async ({ request, execute }) => {
        capturedRunArgs.push(request);
        await execute({ name: "sync_current_portal_page", args: {} });
        await execute({
          name: "draft_page_answers",
          args: { answers: [{ question: "到岗时间", answer: "随时到岗", section: "补充信息" }] },
        });
        return { reply: "已同步本页进度，并为你起草字段。", steps: [] };
      },
    },
    "@/lib/actions/application-sync": {
      syncOpenPortalPage: async (input) => {
        syncInvokedWith = input;
        return {
          ok: true,
          data: {
            companyName: "星图智驾",
            portalAlreadySet: false,
            matched: [{ title: "算法实习生", portalStatus: "笔试中" }],
            changes: [{ title: "算法实习生", portalStatus: "笔试中" }],
            review: [],
          },
        };
      },
    },
    "@/lib/agent/prompt": { buildAgentSystemPrompt: async () => "SYSTEM_BASE" },
    "@/lib/agent/tools": {
      AGENT_TOOLS: [{ name: "query_positions" }],
      describeToolCall: () => "",
      executeTool: async () => ({ content: "" }),
    },
    "@/lib/agent/refs": { collectRefs: () => {} },
    "@/lib/assistant-shared": {},
  });

  const req = new Request("http://localhost/api/agent", {
    method: "POST",
    body: JSON.stringify({
      message: "帮我检查这页进度并起草必填项",
      history: [],
      page: {
        url: "https://campus.example.com/portal/progress",
        title: "投递进度",
        text: "算法实习生 笔试中",
        portalCompanyId: "comp_1",
        portalCompanyName: "星图智驾",
        formFields: [
          { label: "到岗时间", required: true, filled: false, options: ["随时到岗", "1个月内"], section: "补充信息" },
          { label: "自我介绍", required: true, filled: false, maxLength: 300, validationError: "至少填写20字", value: "你好" },
        ],
        uploadSlots: [{ label: "个人简历", fileKind: "resume", uploaded: false }],
      },
    }),
  });
  const res = await POST(req);
  const rawText = await res.text();
  assert.equal(res.status, 200, rawText);
  const events = rawText
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const doneEvent = events.find((e) => e.type === "done");
  assert.ok(doneEvent);
  assert.match(doneEvent.reply, /已同步本页进度/);
  assert.equal(doneEvent.drafts.length, 1);
  assert.equal(doneEvent.drafts[0].section, "补充信息");

  assert.equal(capturedRunArgs.length, 1);
  assert.match(capturedRunArgs[0].system, /页面表单字段清单/);
  assert.match(capturedRunArgs[0].system, /到岗时间/);
  assert.match(capturedRunArgs[0].system, /至少填写20字/);
  assert.match(capturedRunArgs[0].system, /个人简历/);
  assert.ok(capturedRunArgs[0].tools.some((t) => t.name === "sync_current_portal_page"));
  assert.ok(capturedRunArgs[0].tools.some((t) => t.name === "draft_page_answers"));
  assert.deepEqual(JSON.parse(JSON.stringify(syncInvokedWith)), {
    companyId: "comp_1",
    url: "https://campus.example.com/portal/progress",
    pageText: "算法实习生 笔试中",
  });
});

test("Phase 2: browser-view exposes fill-fields, detailed snapshot, and validJdPageForTab gating", async () => {
  const handlers = new Map();
  const fakeWc = {
    getURL: () => "https://jobs.mokahr.com/campus_apply/demo/form",
    getTitle: () => "填写简历 - Demo",
    isLoading: () => false,
    isDestroyed: () => false,
    sendInputEvent: () => {},
    executeJavaScript: async (code) => {
      if (code.startsWith("(async function fillFields") || code.startsWith("(async function fillCustomSelects")) {
        return { filled: ["f_avail"] };
      }
      if (code.startsWith("(function scanPageFields")) {
        return [
          { id: "f_avail", label: "到岗时间", type: "text", currentValue: "", options: ["随时", "下月"], section: "求职意向", required: true, hasValue: false },
          { id: "f_resume", label: "个人简历", type: "file", fileKind: "resume", hasValue: false },
        ];
      }
      if (code.startsWith("(function collectApplicationFields")) {
        return [{ label: "姓名", value: "张三" }];
      }
      if (code.startsWith("(function validatePageFields")) {
        return [{ id: "f_avail", message: "请选择到岗时间" }];
      }
      if (code.includes("capturePageText")) {
        return { text: "基本资料 到岗时间 个人简历", siteName: "Moka" };
      }
      return { ok: true };
    },
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
      getAllEntries: () => [{ url: "https://jobs.mokahr.com/campus_apply/demo/form", title: "填写简历 - Demo" }],
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
    url: "https://jobs.mokahr.com/campus_apply/demo/form",
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
      send: () => {},
      isDestroyed: () => false,
      getURL: () => "http://localhost:3000/browser",
      mainFrame: fakeFrame,
    },
    contentView: { addChildView: () => {}, removeChildView: () => {} },
  };
  const trustedEvent = { sender: fakeWin.webContents, senderFrame: fakeFrame };

  const fakeBrowserViewMod = loadElectronModule("electron/browser-view.js", {
    electron: {
      app: { getPath: () => "/tmp" },
      session: {
        fromPartition: () => ({
          on: () => {},
          clearStorageData: async () => {},
          setUserAgent: () => {},
        }),
      },
      ipcMain: {
        handle: (channel, fn) => handlers.set(channel, fn),
        on: () => {},
        removeHandler: () => {},
      },
      clipboard: { readText: () => "" },
      WebContentsView: function () {
        return { webContents: fakeWc, setBounds: () => {}, setBackgroundColor: () => {} };
      },
      Menu: { buildFromTemplate: () => ({ popup: () => {} }) },
    },
  });

  fakeBrowserViewMod.setupBrowserViewIpc(fakeWin, 3000);
  assert.equal(typeof handlers.get("browser:fill-fields"), "function");
  assert.equal(typeof handlers.get("browser:application-snapshot"), "function");

  const tabId = await handlers.get("browser:new-tab")(trustedEvent, "https://jobs.mokahr.com/campus_apply/demo/form");
  try {
    const snap = await handlers.get("browser:application-snapshot")(trustedEvent, { detailed: true });
    assert.ok(snap);
    assert.equal(snap.contextKey, "page:v2:https://jobs.mokahr.com/campus_apply/demo/form");
    assert.equal(snap.formFields.length, 1);
    assert.equal(snap.formFields[0].validationError, "请选择到岗时间");
    assert.equal(snap.uploadSlots.length, 1);
    assert.equal(snap.uploadSlots[0].uploaded, false);

    const filled = await handlers.get("browser:fill-fields")(trustedEvent, [{ label: "到岗时间", value: "随时", overwrite: false }]);
    assert.equal(filled.filled.length, 1, JSON.stringify(filled));
    assert.equal(filled.filled[0].label, "到岗时间");
    assert.equal(filled.skipped.length, 0);
  } finally {
    await handlers.get("browser:close-tab")(trustedEvent, tabId);
  }

  const coreSrc = fs.readFileSync(path.join(__dirname, "..", "electron", "autofill-core.js"), "utf8");
  assert.equal(/\brequire\(/.test(coreSrc), false);
});
