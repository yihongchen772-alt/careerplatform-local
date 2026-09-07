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
const { runAgentLoop } = loadTs("src/lib/agent-loop.ts");
const decision = (tool, query = "", targetId = "") => ({ tool, query, targetId });

test("uses observations to choose the next tool, then finishes", async () => {
  let turn = 0;
  const result = await runAgentLoop({
    decide: async (observations) => {
      if (turn++ === 0) return decision("search_records", "腾讯");
      assert.match(observations, /position-123/);
      return decision("finish");
    },
    execute: async () => ({ data: "position-123", summary: "找到 1 条" }),
  });
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].status, "success");
});
test("unknown and mutation tools never execute", async () => {
  let executions = 0;
  const result = await runAgentLoop({ decide: async () => decision("delete_application"), execute: async () => { executions++; } });
  assert.equal(executions, 0);
  assert.equal(result.steps[0].status, "error");
});
test("identical calls do not execute twice", async () => {
  let executions = 0;
  const result = await runAgentLoop({ decide: async () => decision("search_records", "百度"), execute: async () => { executions++; return { data: "[]", summary: "没有结果" }; } });
  assert.equal(executions, 1);
  assert.match(result.observations, /重复/);
});
test("tool failures are observations, not fabricated successes", async () => {
  let turn = 0;
  const result = await runAgentLoop({ decide: async (observations) => {
    if (turn++ === 0) return decision("research_web", "岗位");
    assert.match(observations, /未配置搜索 Key/);
    return decision("finish");
  }, execute: async () => { throw new Error("未配置搜索 Key"); } });
  assert.equal(result.steps[0].status, "error");
});
test("hard budget remains four tool calls even if a larger limit is passed", async () => {
  let turn = 0;
  const result = await runAgentLoop({ maxSteps: 100, decide: async () => decision("search_records", String(turn++)), execute: async () => ({ data: "[]", summary: "完成" }) });
  assert.equal(result.steps.length, 4);
  assert.match(result.observations, /预算已用完/);
});

function toolWithDb(db, extras = {}) {
  return loadTs("src/lib/agent-tools.ts", {
    "@/lib/db": { db },
    "@/lib/resume-context": { getResumeContext: async () => ({ resumeName: "简历", resumeText: "真实摘要" }) },
    "@/lib/ai-file-search": { getSearchKey: async () => null },
    "@/lib/action-result": { UserFacingError: Error },
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
test("missing search credentials fail explicitly without a network call", async () => {
  const execute = toolWithDb({});
  await assert.rejects(execute("owner", decision("research_web", "校招")), /联网研究需要/);
});
