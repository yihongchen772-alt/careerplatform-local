const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/autofill-core.js");

// A page that shows the résumé as text (海康威视's 个人中心): no box until a 「编辑」 is pressed.
function viewOnlyAdapter(openResult) {
  const calls = { open: 0 };
  const statuses = [];
  const adapter = {
    url: () => "https://campus.example.invalid/resume",
    stillOnPage: () => true,
    taskId: "t",
    frames: async () => ["main"],
    run: async (_frame, fn) => {
      if (fn === core.openEditSection) { calls.open++; return openResult; }
      if (fn === core.scanPageFields) return [];
      return null;
    },
    api: async () => ({ ok: true, json: async () => ({ fieldMemories: [], mappings: [], name: "测试" }) }),
    status: (s) => statuses.push(s),
    archiveScope: () => "page:v2:test",
  };
  return { adapter, calls, statuses };
}

test("no box on the page: 一键填写 presses one section's 「编辑」, then rescans once — never loops", async () => {
  const { adapter, calls, statuses } = viewOnlyAdapter({ clicked: true, section: "个人信息", more: true });
  const result = await core.runAutofillCore(adapter, null, {});
  assert.equal(calls.open, 1);
  assert.ok(statuses.some((s) => /已点开「个人信息」的「编辑」/.test(s.message || "")));
  // The opened section still showed nothing here, so it ends with the usual hint.
  assert.equal(result.phase, "error");
  assert.match(result.message, /没找到可以填的表单/);
});

test("no 「编辑」 to press: the old message, no extra round", async () => {
  const { adapter, calls } = viewOnlyAdapter({ clicked: false });
  const result = await core.runAutofillCore(adapter, null, {});
  assert.equal(calls.open, 1);
  assert.match(result.message, /没找到可以填的表单/);
});
