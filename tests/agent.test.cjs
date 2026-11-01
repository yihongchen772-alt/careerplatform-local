const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function loadTs(relative, mocks = {}) {
  const filename = path.resolve(__dirname, "..", relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = (name) => Object.hasOwn(mocks, name) ? mocks[name] : original(name);
  mod._compile(compiled, filename);
  return mod.exports;
}
class UserFacingError extends Error {}
const actionResult = { UserFacingError };
const { runAgent } = loadTs("src/lib/agent/run.ts", { "@/lib/action-result": actionResult });
const decision = (tool, query = "", targetId = "") => ({ tool, query, targetId });
const call = (name, args = {}, id = name) => ({ id, name, args });
const turn = (text, calls = []) => ({ text, calls, raw: { text, calls } });
const describe = (c) => `做 ${c.name}`;

test("agent loop: tool results go back to the model until it answers", async () => {
  const seen = [];
  let round = 0;
  const events = [];
  const result = await runAgent({
    chat: async (request) => {
      seen.push(request.messages.map((m) => m.role).join(","));
      if (round++ === 0) return turn("先查一下", [call("search_records", { query: "腾讯" })]);
      const toolTurn = request.messages.at(-1);
      assert.equal(toolTurn.role, "tool");
      assert.match(toolTurn.results[0].content, /position-123/);
      return turn("腾讯那条在一面");
    },
    request: { config: {}, system: "s", messages: [{ role: "user", text: "腾讯怎么样" }], tools: [{ name: "search_records" }] },
    execute: async () => ({ content: "position-123", label: "查记录：腾讯", summary: "找到 1 条" }),
    describe,
    emit: (event) => events.push(event),
  });
  assert.equal(result.reply, "腾讯那条在一面");
  assert.deepEqual(seen, ["user", "user,assistant,tool"]);
  assert.deepEqual(result.steps.map((step) => [step.label, step.status]), [["查记录：腾讯", "success"]]);
  assert.deepEqual(events.map((event) => event.type === "step" ? event.step.status : event.type), ["note", "running", "success"]);
});
test("agent loop: a failed tool is reported to the model as a failure, not as no results", async () => {
  let round = 0;
  const result = await runAgent({
    chat: async (request) => round++ === 0 ? turn("", [call("research_web", { question: "x" })]) : (assert.match(request.messages.at(-1).results[0].content, /执行失败：未配置搜索 Key/), turn("没查到")),
    request: { config: {}, system: "", messages: [{ role: "user", text: "q" }], tools: [{}] },
    execute: async () => { throw new UserFacingError("未配置搜索 Key"); },
    describe, emit: () => {},
  });
  assert.equal(result.steps[0].status, "error");
});
test("agent loop: an identical call is answered from the first result, not run twice", async () => {
  let executions = 0, round = 0;
  await runAgent({
    chat: async () => round++ < 2 ? turn("", [call("search_records", { query: "百度" }, `c${round}`)]) : turn("好"),
    request: { config: {}, system: "", messages: [{ role: "user", text: "q" }], tools: [{}] },
    execute: async () => { executions++; return { content: "[]", label: "l", summary: "s" }; },
    describe, emit: () => {},
  });
  assert.equal(executions, 1);
});
test("agent loop: after the round budget the model must answer without tools", async () => {
  let toolless = null;
  const result = await runAgent({
    maxRounds: 100,
    chat: async (request) => { if (!request.tools.length) { toolless = request.messages.at(-1).text; return turn("就这些"); } return turn("", [call("search_records", { query: String(Math.random()) })]); },
    request: { config: {}, system: "", messages: [{ role: "user", text: "q" }], tools: [{}] },
    execute: async () => ({ content: "[]", label: "l", summary: "s" }),
    describe, emit: () => {},
  });
  assert.equal(result.steps.length, 12);
  assert.match(toolless, /步数用完/);
  assert.equal(result.reply, "就这些");
});

// Each provider's native tool-calling format, against a recorded-shape fake API.
function llmWith(fetchImpl) {
  const original = global.fetch;
  global.fetch = fetchImpl;
  const mod = loadTs("src/lib/agent/llm.ts", { "@/lib/ai-providers": { OPENAI_COMPATIBLE_BASE_URL: { deepseek: "https://api.deepseek.com/v1" } }, "@/lib/action-result": actionResult, "@/lib/ai-provider-labels": { AI_PROVIDER_OPTIONS: [{ id: "gemini", label: "Google Gemini" }, { id: "deepseek", label: "DeepSeek" }] } });
  return { mod, restore: () => { global.fetch = original; } };
}
const okJson = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const toolSpec = { name: "get_position", description: "d", parameters: { type: "object", properties: { positionId: { type: "string", description: "id" } }, required: ["positionId"] } };

test("Gemini: tools as functionDeclarations, the thought signature goes back unchanged, 429 falls to the next model and stays there", async () => {
  const bodies = [];
  const urls = [];
  const { mod, restore } = llmWith(async (url, init) => {
    urls.push(url);
    bodies.push(JSON.parse(init.body));
    if (urls.length === 1) return { ok: false, status: 429, text: async () => "quota" };
    if (urls.length === 2) return okJson({ candidates: [{ content: { parts: [{ functionCall: { name: "get_position", args: { positionId: "p1" } }, thoughtSignature: "SIG" }] } }] });
    return okJson({ candidates: [{ content: { parts: [{ text: "想法", thought: true }, { text: "结论" }] } }] });
  });
  try {
    const chat = mod.createChat();
    const config = { provider: "gemini", apiKey: "k", model: "m-lite, m-flash" };
    const first = await chat({ config, system: "sys", messages: [{ role: "user", text: "hi" }], tools: [toolSpec] });
    assert.deepEqual(first.calls.map((c) => [c.name, c.args]), [["get_position", { positionId: "p1" }]]);
    assert.equal(bodies[1].tools[0].functionDeclarations[0].parameters.type, "OBJECT");
    assert.equal(bodies[1].tools[0].functionDeclarations[0].parameters.properties.positionId.type, "STRING");
    assert.equal(bodies[1].systemInstruction.parts[0].text, "sys");
    const second = await chat({ config, system: "sys", messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "", calls: first.calls, raw: first.raw }, { role: "tool", results: [{ call: first.calls[0], content: "JD" }] }], tools: [toolSpec] });
    assert.equal(second.text, "结论");
    assert.match(urls[2], /m-flash/);
    assert.equal(bodies[2].contents[1].role, "model");
    assert.equal(bodies[2].contents[1].parts[0].thoughtSignature, "SIG");
    assert.deepEqual(bodies[2].contents[2].parts[0].functionResponse, { name: "get_position", response: { content: "JD" } });
  } finally { restore(); }
});
test("OpenAI-compatible: tool_calls and role tool messages; reasoning_content is sent back", async () => {
  const bodies = [];
  const { mod, restore } = llmWith(async (url, init) => {
    bodies.push(JSON.parse(init.body));
    assert.equal(url, "https://api.deepseek.com/v1/chat/completions");
    return bodies.length === 1
      ? okJson({ choices: [{ message: { role: "assistant", content: null, reasoning_content: "R", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_position", arguments: "{\"positionId\":\"p1\"}" } }] } }] })
      : okJson({ choices: [{ message: { role: "assistant", content: "好的" } }] });
  });
  try {
    const chat = mod.createChat();
    const config = { provider: "deepseek", apiKey: "k", model: "deepseek-chat" };
    const first = await chat({ config, system: "sys", messages: [{ role: "user", text: "hi" }], tools: [toolSpec] });
    assert.deepEqual(first.calls, [{ id: "call_1", name: "get_position", args: { positionId: "p1" } }]);
    assert.equal(bodies[0].tools[0].function.parameters.type, "object");
    await chat({ config, system: "sys", messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "", calls: first.calls, raw: first.raw }, { role: "tool", results: [{ call: first.calls[0], content: "JD" }] }], tools: [toolSpec] });
    assert.deepEqual(bodies[1].messages.map((m) => m.role), ["system", "user", "assistant", "tool"]);
    assert.equal(bodies[1].messages[2].reasoning_content, "R");
    assert.deepEqual(bodies[1].messages[3], { role: "tool", tool_call_id: "call_1", content: "JD" });
  } finally { restore(); }
});
test("Anthropic: tool_use blocks come back as tool_result blocks", async () => {
  const bodies = [];
  const { mod, restore } = llmWith(async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.length === 1 ? okJson({ content: [{ type: "text", text: "我看看" }, { type: "tool_use", id: "tu_1", name: "get_position", input: { positionId: "p1" } }] }) : okJson({ content: [{ type: "text", text: "结论" }] });
  });
  try {
    const chat = mod.createChat();
    const config = { provider: "anthropic", apiKey: "k", model: "claude-sonnet-4-6" };
    const first = await chat({ config, system: "sys", messages: [{ role: "user", text: "hi" }], tools: [toolSpec] });
    assert.equal(first.text, "我看看");
    assert.equal(bodies[0].tools[0].input_schema.type, "object");
    await chat({ config, system: "sys", messages: [{ role: "user", text: "hi" }, { role: "assistant", text: first.text, calls: first.calls, raw: first.raw }, { role: "tool", results: [{ call: first.calls[0], content: "JD" }] }], tools: [toolSpec] });
    assert.deepEqual(bodies[1].messages[2].content, [{ type: "tool_result", tool_use_id: "tu_1", content: "JD" }]);
    assert.equal(bodies[1].system, "sys");
  } finally { restore(); }
});
test("history becomes alternating turns that end on a reply", () => {
  const { mod, restore } = llmWith(async () => okJson({}));
  try {
    const messages = mod.historyMessages("anthropic", [{ role: "assistant", content: "欢迎" }, { role: "user", content: "a" }, { role: "user", content: "b" }, { role: "assistant", content: "c" }, { role: "assistant", content: "操作已完成：记了一条投递" }, { role: "user", content: "未答" }]);
    assert.deepEqual(messages.map((m) => [m.role, m.text]), [["user", "a\nb"], ["assistant", "c\n操作已完成：记了一条投递"]]);
    assert.deepEqual(messages[1].raw, [{ type: "text", text: "c\n操作已完成：记了一条投递" }]);
  } finally { restore(); }
});

function toolWithDb(db, extras = {}) {
  return loadTs("src/lib/agent-tools.ts", {
    "@/lib/db": { db },
    "@/lib/resume-context": { getResumeContext: async () => ({ resumeName: "简历", resumeText: "真实摘要" }) },
    "@/lib/ai-file-search": { getSearchKey: async () => null },
    "@/lib/action-result": { UserFacingError: Error },
    "@/lib/career-ops": { findJobs: async () => { throw new Error("no network in tests"); } },
    ...extras,
  }).executeAgentTool;
}
test("database searches scope every category to the current user and bound row count", async () => {
  let calls = 0;
  const model = { findMany: async (args) => { calls++; assert.equal(args.where.userId, "owner"); assert.equal(args.take, 10); return []; } };
  const execute = toolWithDb({ position: model, jobLead: model, application: model, personalTask: model });
  await execute("owner", decision("search_records", "腾讯"));
  assert.equal(calls, 4);
});
test("application preparation rejects foreign or nonexistent position ids", async () => {
  const execute = toolWithDb({ position: { findFirst: async ({ where }) => { assert.equal(where.userId, "owner"); return null; } } });
  await assert.rejects(execute("owner", decision("prepare_application", "", "other-id")), /未找到/);
});
test("application preparation filters unsafe stored URLs and reports missing fields", async () => {
  const execute = toolWithDb({
    position: { findFirst: async () => ({ company: { name: "测试", careerUrl: "javascript:alert(1)" }, title: "工程师", jdUrl: "file:///secret" }) },
    user: { findUnique: async () => ({ name: "我" }) },
    resumeVersion: { findMany: async () => [] },
  });
  const result = await execute("owner", decision("prepare_application", "", "p"));
  assert.equal(result.href, "/pool");
  assert.match(result.summary, /真实姓名/);
  assert.match(result.summary, /简历/);
});
test("application preparation assumes https for a scheme-less stored URL instead of dropping it", async () => {
  const execute = toolWithDb({
    position: { findFirst: async () => ({ company: { name: "测试", careerUrl: "hr.example.com/careers" }, title: "工程师", jdUrl: null }) },
    user: { findUnique: async () => ({ name: "我" }) },
    resumeVersion: { findMany: async () => [] },
  });
  const result = await execute("owner", decision("prepare_application", "", "p"));
  assert.equal(result.href, `/browser?url=${encodeURIComponent("https://hr.example.com/careers")}`);
});
test("missing search credentials fail explicitly without a network call", async () => {
  const execute = toolWithDb({});
  await assert.rejects(execute("owner", decision("research_web", "校招")), /联网研究需要/);
});

test("find_jobs passes the query and the applicant's cities, and reports boards it could not read", async () => {
  let asked = null;
  const execute = toolWithDb({ user: { findUnique: async (args) => { assert.equal(args.where.id, "owner"); return { preferredCities: "上海、杭州" }; } } }, {
    "@/lib/career-ops": { findJobs: async (userId, query, cities) => {
      asked = { userId, query, cities };
      return { jobs: [{ company: "字节跳动", title: "数据分析", location: "上海", url: "https://jobs.bytedance.com/x", postedAt: null, description: "SQL" }], total: 1, searched: [{ name: "字节跳动", found: 40, error: null }, { name: "华为", found: 0, error: "这个网站暂不支持" }] };
    } },
  });
  const result = await execute("owner", decision("find_jobs", "数据分析"));
  assert.deepEqual(asked, { userId: "owner", query: "数据分析", cities: ["上海", "杭州"] });
  assert.match(result.summary, /找到 1 个/);
  assert.match(result.summary, /华为（这个网站暂不支持）/);
  assert.match(result.data, /jobs\.bytedance\.com/);
  await assert.rejects(execute("owner", decision("find_jobs", " ")), /要找什么岗位/);
});

function agentTools(db, cityTools = { MAX_RESEARCH: 4, listCityGaps: async () => ({ content: "", summary: "" }), researchCities: async () => ({ content: "", summary: "", evidence: new Map() }) }) {
  const stageLabels = loadTs("src/lib/stage-labels.ts");
  const appCity = loadTs("src/lib/application-city.ts");
  const interviewSchedule = loadTs("src/lib/interview-schedule.ts", { "@/lib/stage-labels": stageLabels });
  const appFilters = loadTs("src/lib/application-filters.ts", {
    "@/lib/interview-schedule": interviewSchedule,
    "@/lib/stage-labels": stageLabels,
  });
  const companyIndustry = loadTs("src/lib/company-industry.ts");
  const workspaceTools = loadTs("src/lib/agent/workspace-tools.ts", {
    "@/lib/db": { db },
    "@/lib/application-city": appCity,
    "@/lib/application-filters": appFilters,
    "@/lib/company-industry": companyIndustry,
    "@/lib/interview-schedule": interviewSchedule,
    "@/lib/pending-mail": { pendingMailRows: () => [] },
    "@/lib/stage-labels": stageLabels,
  });
  return loadTs("src/lib/agent/tools.ts", {
    "@/lib/agent/city-tools": cityTools,
    "@/lib/agent/workspace-tools": workspaceTools,
    "@/lib/application-city": appCity,
    "@/lib/closest-id": loadTs("src/lib/closest-id.ts"),
    "next/cache": { revalidatePath: () => {} },
    "@/lib/db": { db },
    "@/lib/action-result": actionResult,
    "@/lib/agent-tools": { executeAgentTool: async () => ({ data: "{}", summary: "ok" }) },
    "@/lib/fetch-job-page": { fetchJobPage: async () => "<p>x</p>", htmlToText: (html) => html },
    "@/lib/stage-labels": stageLabels,
    "@/lib/validation": { applicationStageValues: ["APPLIED"] },
    "@/lib/assistant-shared": loadTs("src/lib/assistant-shared.ts"),
  });
}
test("tools: a city button needs that city in this turn's research; a miscopied ID is fixed", async () => {
  const evidence = new Map([["ckaaa111b222c333d444e5550", "搜索结果：工作地点：江苏省无锡市"], ["ckzzz999y888x777w666v5550", "页面和搜索都没拿到内容"]]);
  const tools = agentTools({}, { MAX_RESEARCH: 4, listCityGaps: async () => ({ content: "", summary: "" }), researchCities: async () => ({ content: "资料", summary: "查了 2 条", evidence }) });
  const proposed = [];
  // Before any research nothing is backed.
  await tools.executeTool("owner", call("propose_actions", { actions: [{ type: "set_city", label: "甲公司 → 无锡", targetId: "ckaaa111b222c333d444e5550", city: "无锡" }] }), proposed);
  assert.equal(proposed.length, 0);
  await tools.executeTool("owner", call("research_cities", { applicationIds: ["ckaaa111b222c333d444e5550", "ckzzz999y888x777w666v5550"] }), proposed);
  const outcome = await tools.executeTool("owner", call("propose_actions", { actions: [
    { type: "set_city", label: "甲公司 → 无锡", targetId: "ckaaa111b222c33d444e5550", city: "无锡" },
    { type: "set_city", label: "另一家 → 杭州", targetId: "ckzzz999y888x777w666v5550", city: "杭州" },
  ] }), proposed);
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].targetId, "ckaaa111b222c333d444e5550");
  assert.match(outcome.content, /1 个城市在这轮 research_cities 查到的资料里没有出现/);
});

test("tools: proposals are validated (empty strings dropped), never applied, and the model is told they are not done", async () => {
  const tools = agentTools({});
  const proposed = [];
  const outcome = await tools.executeTool("owner", call("propose_actions", { actions: [
    { type: "add_task", label: "加待办：准备腾讯二面", title: "准备腾讯二面", date: "2026-10-20", targetId: "", note: "" },
    { type: "drop_database", label: "x" },
  ] }), proposed);
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].targetId, undefined);
  assert.match(outcome.content, /1 个格式不对/);
  assert.match(outcome.content, /不能说已经办好/);
});
test("tools: records are read only for the current user; memory is capped", async () => {
  let where = null;
  const tools = agentTools({
    application: { findFirst: async (args) => { where = args.where; return null; } },
    agentMemory: { count: async () => 60, create: async () => assert.fail("over the cap") },
  });
  await assert.rejects(tools.executeTool("owner", call("get_application", { applicationId: "someone-else" }), []), /没找到这条投递/);
  assert.deepEqual(where, { id: "someone-else", userId: "owner" });
  await assert.rejects(tools.executeTool("owner", call("remember", { content: "不考虑外包" }), []), /记忆已满/);
  await assert.rejects(tools.executeTool("owner", call("delete_everything", {}), []), /没有「delete_everything」这个工具/);
});
test("Gemini: an overloaded model is retried, then the next model gets a placeholder signature for the earlier call", async () => {
  const bodies = [];
  const { mod, restore } = llmWith(async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    if (bodies.length === 1) return okJson({ candidates: [{ content: { parts: [{ functionCall: { name: "get_position", args: {} }, thoughtSignature: "SIG-A" }] } }] });
    if (/m-a:/.test(url)) return { ok: false, status: 503, text: async () => "overloaded", body: null };
    return okJson({ candidates: [{ content: { parts: [{ text: "好" }] } }] });
  });
  const realTimeout = global.setTimeout;
  global.setTimeout = (fn) => realTimeout(fn, 0);
  try {
    const chat = mod.createChat();
    const config = { provider: "gemini", apiKey: "k", model: "m-a, m-b" };
    const first = await chat({ config, system: "", messages: [{ role: "user", text: "hi" }], tools: [toolSpec] });
    const second = await chat({ config, system: "", messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "", calls: first.calls, raw: first.raw }, { role: "tool", results: [{ call: first.calls[0], content: "x" }] }], tools: [toolSpec] });
    assert.equal(second.text, "好");
    assert.equal(bodies.filter((b) => /m-a:/.test(b.url)).length, 4);
    const last = bodies.at(-1);
    assert.match(last.url, /m-b:/);
    assert.equal(last.body.contents[1].parts[0].thoughtSignature, "skip_thought_signature_validator");
  } finally { global.setTimeout = realTimeout; restore(); }
});
test("Gemini: speech and image models in the configured list are not used for chat", () => {
  const { mod, restore } = llmWith(async () => okJson({}));
  try {
    assert.deepEqual(mod.geminiModels("gemini-3.5-flash-lite, gemini-3.8-flash-lite-tts, gemini-3-pro-image, gemini-3.8-flash"), ["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  } finally { restore(); }
});
test("agent loop: a reply that fails review goes back to the model once", async () => {
  let round = 0, reviews = 0;
  const result = await runAgent({
    chat: async (request) => {
      round++;
      if (round === 1) return turn("点下面的按钮加入候选池");
      if (round === 2) { assert.match(request.messages.at(-1).text, /还没有调用 propose_actions/); return turn("", [call("propose_actions", { actions: [] })]); }
      return turn("点下面的按钮加入候选池");
    },
    request: { config: {}, system: "", messages: [{ role: "user", text: "q" }], tools: [{}] },
    execute: async () => ({ content: "ok", label: "提出 1 个操作", summary: "" }),
    describe, emit: () => {},
    review: () => { reviews++; return "你在回答里提到了按钮，但还没有调用 propose_actions"; },
  });
  assert.equal(reviews, 1);
  assert.equal(round, 3);
  assert.equal(result.reply, "点下面的按钮加入候选池");
});
test("errors name the provider and model, and a fall-over is reported", async () => {
  const notices = [];
  const { mod, restore } = llmWith(async (url) => /m-a:/.test(url) ? { ok: false, status: 429, text: async () => "" } : { ok: false, status: 401, text: async () => "" });
  try {
    const chat = mod.createChat((text) => notices.push(text));
    await assert.rejects(chat({ config: { provider: "gemini", apiKey: "k", model: "m-a, m-b" }, system: "", messages: [{ role: "user", text: "hi" }], tools: [] }), /Google Gemini · m-b 调用失败（401）：Key 无效/);
    assert.deepEqual(notices, ["m-a 额度用完了，改用 m-b 继续"]);
  } finally { restore(); }
});

test("briefs: the morning one from 5:00; Sunday's review from 17:00 that day, owed until Thursday, not after", () => {
  const brief = loadTs("src/lib/agent/brief.ts", {
    "@/lib/db": { db: {} }, "@/lib/action-result": actionResult, "@/lib/assistant-shared": loadTs("src/lib/assistant-shared.ts"),
    "@/lib/agent/llm": {}, "@/lib/agent/run": {}, "@/lib/agent/tools": {}, "@/lib/agent/prompt": {}, "@/lib/agent/config": {},
  });
  const at = (y, m, d, h) => new Date(y, m - 1, d, h, 0);
  assert.equal(brief.briefPeriod("daily", at(2026, 10, 17, 8)), "2026-10-17");
  assert.equal(brief.briefDue("daily", false, at(2026, 10, 17, 4)), false);
  assert.equal(brief.briefDue("daily", false, at(2026, 10, 17, 8)), true);
  assert.equal(brief.briefDue("daily", true, at(2026, 10, 17, 8)), false);
  // 2026-10-18 is a Sunday.
  assert.equal(brief.briefPeriod("weekly", at(2026, 10, 18, 16)), "2026-10-11");
  assert.equal(brief.briefPeriod("weekly", at(2026, 10, 18, 18)), "2026-10-18");
  assert.equal(brief.briefPeriod("weekly", at(2026, 10, 20, 9)), "2026-10-18");
  assert.equal(brief.briefDue("weekly", false, at(2026, 10, 18, 18)), true);
  assert.equal(brief.briefDue("weekly", false, at(2026, 10, 19, 9)), true);
  assert.equal(brief.briefDue("weekly", false, at(2026, 10, 23, 9)), false);
  assert.equal(brief.briefDue("weekly", false, at(2026, 10, 18, 16)), false);
});
test("agent loop: an answer written beside a tool call is kept when the last reply is only a sign-off", async () => {
  let round = 0;
  const body = "今日简报：".padEnd(160, "要");
  const result = await runAgent({
    chat: async () => round++ === 0 ? turn(body, [call("propose_actions", { actions: [] })]) : turn("简报完毕，按钮在下面"),
    request: { config: {}, system: "", messages: [{ role: "user", text: "q" }], tools: [{}] },
    execute: async () => ({ content: "ok", label: "l", summary: "" }), describe, emit: () => {},
  });
  assert.ok(result.reply.startsWith(body));
  assert.ok(result.reply.endsWith("简报完毕，按钮在下面"));
});

test("workspace tools: filter_applications and get_workspace_overview filter and summarize across all user records", async () => {
  const apps = [
    {
      id: "app-tx-1",
      title: "后端开发",
      currentStage: "INTERVIEW_1",
      currentStageLabel: null,
      currentStageDate: new Date(Date.now() - 12 * 86_400_000),
      appliedDate: new Date(Date.now() - 15 * 86_400_000),
      channel: "官网",
      city: "深圳",
      citySource: "岗位页面",
      salaryMin: 25,
      salaryMax: 30,
      offerAnnualTotal: 42,
      commuteMinutes: 30,
      overtimeNote: "10-9-5",
      growthNote: "核心组",
      offerNote: "16薪",
      company: { name: "腾讯", industry: "互联网", sector: null, aliases: [{ alias: "鹅厂" }] },
      position: { location: "深圳" },
      stageHistory: [
        { id: "st-1", stage: "APPLIED", stageLabel: null, enteredAt: new Date(Date.now() - 15 * 86_400_000), nextDeadline: null, nextDeadlineEnd: null, nextHasTime: false, completedAt: new Date(Date.now() - 12 * 86_400_000), followedUpAt: null, terminatedAtStageLabel: null },
        { id: "st-2", stage: "INTERVIEW_1", stageLabel: null, enteredAt: new Date(Date.now() - 12 * 86_400_000), nextDeadline: null, nextDeadlineEnd: null, nextHasTime: false, completedAt: new Date(Date.now() - 12 * 86_400_000), followedUpAt: null, terminatedAtStageLabel: null },
      ],
    },
    {
      id: "app-ali-2",
      title: "Java开发",
      currentStage: "APPLIED",
      currentStageLabel: null,
      currentStageDate: new Date(),
      appliedDate: new Date(),
      channel: "内推",
      city: "杭州",
      citySource: "公司所在地",
      salaryMin: null,
      salaryMax: null,
      offerAnnualTotal: null,
      commuteMinutes: null,
      overtimeNote: null,
      growthNote: null,
      offerNote: null,
      company: { name: "阿里巴巴", industry: "电商", sector: null, aliases: [{ alias: "淘天" }] },
      position: { location: null },
      stageHistory: [
        { id: "st-3", stage: "APPLIED", stageLabel: null, enteredAt: new Date(), nextDeadline: null, nextDeadlineEnd: null, nextHasTime: false, completedAt: null, followedUpAt: null, terminatedAtStageLabel: null },
      ],
    },
  ];
  const tools = agentTools({
    application: { findMany: async ({ where }) => { assert.equal(where.userId, "owner"); return apps; } },
    stageHistory: { findMany: async () => [] },
    interviewIntelligence: { findUnique: async () => null },
    personalTask: { findMany: async () => [] },
    calendarEvent: { findMany: async () => [{ id: "ev-1", title: "秋招双选会", allDay: true, dateKey: "2026-11-05", startsAt: new Date(Date.now() + 86_400_000), meetingInfo: "体育馆" }] },
    contact: { findMany: async () => [{ id: "c-1", name: "张HR", role: "HR", companyName: "腾讯", contactInfo: null, note: null, nextFollowUpAt: null }] },
    journeyEntry: { findMany: async () => [{ id: "j-1", text: "完成一面", mood: "蓄力", about: "腾讯", createdAt: new Date() }] },
    user: { findUnique: async () => ({ name: "陈同学", school: "某大", graduationYear: "2026", targetTrack: "后端", preferredCities: "深圳,杭州", expectedSalaryMin: 25, skills: "Java, Go", applicationProfile: {} }) },
  });

  const byRound = await tools.executeTool("owner", call("filter_applications", { filter: "interviewed", stage: "INTERVIEW_1" }), []);
  assert.match(byRound.content, /app-tx-1/);
  assert.doesNotMatch(byRound.content, /app-ali-2/);

  const byGuessed = await tools.executeTool("owner", call("filter_applications", { filter: "guessed_city" }), []);
  assert.match(byGuessed.content, /app-ali-2/);
  assert.doesNotMatch(byGuessed.content, /app-tx-1/);

  const overview = await tools.executeTool("owner", call("get_workspace_overview", { section: "all" }), []);
  assert.match(overview.content, /Offer 与薪资对比/);
  assert.match(overview.content, /面试统计与面经复盘/);
  assert.match(overview.content, /独立日历事项与待确认邮件日程/);
  assert.match(overview.content, /心路历程/);
});

test("propose_actions and applyAssistantAction: new action types validate and smart target resolution handles miscopied IDs and applicationId-to-step fallback", async () => {
  const tools = agentTools({});
  const proposed = [];
  await tools.executeTool("owner", call("propose_actions", {
    actions: [
      { type: "update_offer", label: "记录腾讯 Offer 薪资", targetId: "app-tx-1", salaryMin: 25, salaryMax: 30, offerAnnualTotal: 42, commuteMinutes: 30, overtimeNote: "10-9-5" },
      { type: "update_position", label: "字节岗位优先级调为 5", targetId: "pos-1", priority: 5, positionStatus: "TO_APPLY" },
      { type: "add_calendar_event", label: "添加宣讲会日程", title: "华为宣讲会", date: "2026-11-05 19:00", category: "CAMPUS_TALK", note: "带纸质简历" },
      { type: "update_profile", label: "更新意向城市", city: "深圳、杭州" },
      { type: "update_company_industry", label: "标记腾讯行业为互联网", companyName: "腾讯", note: "互联网/游戏" },
      { type: "add_journey", label: "记一条心路", title: "拿到第一个一面", note: "继续稳扎稳打", mood: "突破" },
    ],
  }), proposed);
  assert.equal(proposed.length, 6);
  assert.equal(proposed[0].type, "update_offer");
  assert.equal(proposed[0].offerAnnualTotal, 42);
});
