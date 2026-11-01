const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file) {
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require, console });
  return mod.exports;
}
const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("小欧 can propose a city for a 投递 as a button", () => {
  const { assistantActionSchema } = load("src/lib/assistant-shared.ts");
  const parsed = assistantActionSchema.safeParse({ type: "set_city", label: "银杏电子 · 硬件 → 上海", targetId: "app1", city: "上海、苏州" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.city, "上海、苏州");
  // The city the button writes is read like a hand-typed one.
  const city = load("src/lib/application-city.ts");
  assert.deepEqual(plain(city.parseCities("上海、苏州")), ["上海", "苏州"]);
  assert.deepEqual(plain(city.parseCities("江苏省苏州市")), ["苏州"]);
});

test("小欧 has tools to list and research missing cities, and is told how to use them", () => {
  const tools = read("src/lib/agent/tools.ts");
  for (const name of ["list_missing_cities", "research_cities"]) {
    assert.match(tools, new RegExp(`name: "${name}"`));
    assert.match(tools, new RegExp(`case "${name}"`));
  }
  assert.match(tools, /city: str\(/, "propose_actions carries the city field");
  // A city button only for a city found in this turn's research.
  assert.match(tools, /type === "set_city" && !cityBacked\(/);
  assert.match(tools, /cities\.every\(\(city\) => material\.includes\(city\)\)/);
  assert.match(read("src/lib/assistant-context.ts"), /- set_city：/);
  assert.match(read("src/lib/agent/prompt.ts"), /list_missing_cities/);
  // Writes only on the user's click, and only that user's row.
  const executor = read("src/lib/actions/assistant.ts");
  assert.match(executor, /case "set_city"[\s\S]*?where: \{ id: a\.targetId, userId: user\.id \}/);
});

test("research stays within one tool result and never answers a search check", () => {
  const source = read("src/lib/agent/city-tools.ts");
  const constant = (name) => Number(source.match(new RegExp(`${name} = (\\d+)`))[1]);
  const MAX_RESEARCH = constant("MAX_RESEARCH");
  const sizes = ["PAGE_HEAD", "JOB_SEARCH", "COMPANY_SEARCH"].map(constant);
  const MAX_RESULT_CHARS = Number(read("src/lib/agent/run.ts").match(/MAX_RESULT_CHARS = (\d+)/)[1]);
  assert.ok(MAX_RESEARCH * (sizes.reduce((a, b) => a + b, 0) + 200) < MAX_RESULT_CHARS);
  const search = read("src/lib/city-search.ts");
  assert.match(search, /最后一步\|请解决以下难题\|captcha/);
  // An engine that asks for a check rests; the next one is used.
  assert.match(search, /engine\.blockedUntil = Date\.now\(\) \+ BLOCK_PAUSE;\s*break;/);
  assert.match(search, /name: "Bing"[\s\S]*name: "搜狗"[\s\S]*name: "360"/);
  // The 投递 page's own lookup shares the same search and pause.
  assert.match(read("src/lib/actions/city-lookup.ts"), /from "@\/lib\/city-search"/);
});

test("「让小欧查」 sends the question straight away; 「全部保存」 saves every button", () => {
  const bar = read("src/components/applications/city-lookup-bar.tsx");
  assert.match(bar, /xiaoou:ask[\s\S]*?send: true/);
  const widget = read("src/components/assistant/assistant-widget.tsx");
  assert.match(widget, /setAskSend\(detail\.send === true\)/);
  const chat = read("src/components/assistant/agent-chat.tsx");
  assert.match(chat, /if \(askSend\) void handleSend\(askText\)/);
  assert.match(chat, /全部保存（/);
});

test("a slightly miscopied 投递ID still finds its 投递, but never a guess between two", () => {
  const { closestId } = load("src/lib/closest-id.ts");
  assert.equal(closestId("ckaaa111b222c333d444e5550", ["ckaaa111b222c333d444e5550", "x"]), "ckaaa111b222c333d444e5550");
  assert.equal(closestId("ckaaa111b222c33d444e5550", ["ckaaa111b222c333d444e5550", "ckzzz999y888x777w666v5550"]), "ckaaa111b222c333d444e5550");
  assert.equal(closestId("ckaaa111b222c333d444e555", ["ckaaa111b222c333d444e5550", "ckaaa111b222c333d444e5551"]), null);
  assert.equal(closestId("totally-different-id-0000", ["ckaaa111b222c333d444e5550"]), null);
});
