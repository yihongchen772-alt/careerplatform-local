const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../src/lib/inbox-identity.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const identity = { exports: {} };
vm.runInNewContext(compiled, { module: identity, exports: identity.exports, require });
const { unseenUids, mailTaskKey, duplicateImportedTaskIds } = identity.exports;

test("IMAP's open-ended UID range cannot re-import the last message", () => {
  assert.deepEqual(Array.from(unseenUids([42], 42)), []);
  assert.deepEqual(Array.from(unseenUids([44, 43, 43, 42], 42)), [43, 44]);
  assert.deepEqual(Array.from(unseenUids([0, -1, 4, 2], null)), [2, 4]);
});

test("mailbox and UID together identify one imported task", () => {
  assert.equal(mailTaskKey("inbox-a", 42), mailTaskKey("inbox-a", 42));
  assert.notEqual(mailTaskKey("inbox-a", 42), mailTaskKey("inbox-b", 42));
});

test("cleanup only selects byte-identical, untouched legacy mail imports", () => {
  const base = {
    title: "面试邀请：某公司",
    note: "面试已安排\n\n邮件主题：面试邀请\n来自：hr@example.test\n收件箱：测试邮箱",
    sourceMailKey: null,
    done: false,
    dueDate: null,
    dueDateEnd: null,
    positionId: null,
    applicationId: null,
  };
  const tasks = [
    { ...base, id: "original", createdAt: new Date(1000) },
    { ...base, id: "duplicate", createdAt: new Date(2000) },
    { ...base, id: "edited", done: true, createdAt: new Date(3000) },
    { ...base, id: "new-format", sourceMailKey: "inbox-a:42", createdAt: new Date(4000) },
    { ...base, id: "different", note: `${base.note}\n另一次提醒`, createdAt: new Date(5000) },
  ];
  assert.deepEqual(Array.from(duplicateImportedTaskIds(tasks)), ["duplicate"]);
});
