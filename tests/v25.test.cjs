const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/autofill-core.js");

test("社交账号：平台和 URL / ID 成对，ID 跟着该行实际的平台走", () => {
  const f = (id, label, extra = {}) => ({ id, label, tag: "custom-select", hasValue: false, currentValue: "", ...extra });
  const profile = { wechat: "zoe_lin_wx", qq: "123456789" };
  const fields = [f("t1", "社交平台*"), f("i1", "URL / ID*", { tag: "input" }), f("t2", "社交平台*"), f("i2", "URL / ID*", { tag: "input" })];
  const values = core.socialValues(fields, profile);
  assert.deepEqual(["t1", "i1", "t2", "i2"].map((id) => values.get(id)), ["微信", "zoe_lin_wx", "QQ", "123456789"]);
  // Row one already shows QQ (picked by the user): its ID is the QQ number, never the wechat one.
  const picked = [f("t1", "社交平台", { hasValue: true, currentValue: "QQ" }), f("i1", "URL / ID", { tag: "input" })];
  assert.equal(core.socialValues(picked, profile).get("i1"), "123456789");
  assert.equal(core.socialValues(picked, profile).has("t1"), false, "a chosen platform is left alone");
  // A platform we hold no account for gets no ID; nothing saved means nothing guessed.
  const other = [f("t1", "社交平台", { hasValue: true, currentValue: "领英" }), f("i1", "URL / ID", { tag: "input" })];
  assert.equal(core.socialValues(other, profile).size, 0);
  assert.equal(core.socialValues(fields, {}).size, 0);
});

test("职位搜索页里敲搜索框不算「手填」，不会自动存样本", async () => {
  const run = async (fields, state) => {
    const adapter = { url: () => "https://fixture.example/campus/jobs", stillOnPage: () => true, frames: async () => [0], getDrafts: () => [], setDrafts() {}, run: async (_, fn, args) => {
      if (fn === core.hasUserEditedFields) return true;
      if (fn === core.scanPageFields) return fields;
      if (fn === core.readFieldValues) return Object.fromEntries(args[0].map((id) => [id, state[id]]));
    }, api: async () => ({ ok: true, json: async () => ({ saved: 0, processed: 0 }) }) };
    return core.saveCorrectionsCore(adapter, undefined, false);
  };
  const typed = (id) => [id, { value: "机器人", userEdited: true, editedAt: 1 }];
  // ubtrobot's 校招职位 list: two unlabeled boxes, all typed in.
  const list = [{ id: "c0-f0", label: "", tag: "input" }, { id: "c0-f1", label: "", tag: "input" }];
  assert.equal((await run(list, Object.fromEntries([typed("c0-f0"), typed("c0-f1")]))).handTyped, 0);
  // A search box inside a real form is skipped, the other typed boxes still count.
  const form = [{ id: "a", label: "搜索职位关键词", tag: "input" }, { id: "b", label: "期望月薪", tag: "input" }, { id: "c", label: "推荐码", tag: "input" }, { id: "d", label: "QQ 号", tag: "input" }];
  const result = await run(form, Object.fromEntries(["a", "b", "c", "d"].map(typed)));
  assert.ok(result.handTyped <= 3 && result.handTyped >= 1, `search box not counted, got ${result.handTyped}`);
});

test("故意不填的栏目（身份证、家庭成员）和真没填上的分开标记", () => {
  const f = (label, extra = {}) => ({ id: label, label, tag: "input", type: "text", section: "", ...extra });
  const none = new Set();
  assert.equal(core.fillDetail(f("身份证号码"), null, none, none).deliberate, true);
  assert.equal(core.fillDetail(f("紧急联系人姓名"), null, none, none).deliberate, true);
  assert.equal(core.fillDetail(f("某个没见过的栏目"), null, none, none).deliberate, undefined);
  assert.equal(core.fillDetail(f("某个没见过的栏目"), null, none, none).source, "manual");
});
