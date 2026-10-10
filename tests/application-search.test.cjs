const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Finding one company among many 投递记录.
function loadTs(relative) {
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require, Intl });
  return mod.exports;
}
const { initialsOf, matchApplication, highlightParts, compareCompanyNames } = loadTs("src/lib/application-search.ts");

const app = (companyName, title, aliases = []) => ({ companyName, title, aliases });
// Objects from the vm context have their own prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));
const initials = (text) => Array.from(text, (char) => initialsOf(char)[0] || "").join("");

test("pinyin initials come from the collation, with both readings for common polyphones", () => {
  assert.equal(initials("字节跳动"), "zjtd");
  assert.equal(initials("阿里巴巴"), "albb");
  assert.equal(initials("拼多多"), "pdd");
  assert.equal(initials("哔哩哔哩"), "blbl");
  assert.equal(initialsOf("行"), "hx");
  assert.ok(matchApplication(app("招商银行", "管培生"), "zsyh"));
  assert.ok(matchApplication(app("重庆银行", "柜员"), "cqyh"));
  assert.ok(matchApplication(app("长江存储", "工艺工程师"), "cjcc"));
  assert.ok(matchApplication(app("厦门航空", "乘务员"), "xmhk"));
  assert.equal(initialsOf("·"), "");
  assert.equal(initialsOf("A"), "a");
});

test("a company is found by part of its name, an alias, its job, or initials", () => {
  assert.ok(matchApplication(app("字节跳动", "数据分析师"), "字节"));
  assert.ok(matchApplication(app("字节跳动", "数据分析师"), "zj"));
  assert.ok(matchApplication(app("字节跳动", "数据分析师"), "ByteDance") === null);
  assert.equal(matchApplication(app("字节跳动", "数据分析师", ["ByteDance", "头条"]), "bytedance").alias, "ByteDance");
  assert.ok(matchApplication(app("字节跳动", "数据分析师"), "数据"));
  assert.ok(matchApplication(app("字节跳动", "数据分析师"), "sjfx"));
  // Full-width and case don't matter; spaces inside a name don't either.
  assert.ok(matchApplication(app("OPPO 中国", "影像算法"), "ｏｐｐｏ"));
  assert.ok(matchApplication(app("OPPO 中国", "影像算法"), "oppozg"));
  assert.equal(matchApplication(app("腾讯", "产品经理"), "阿里"), null);
});

test("every term has to match: company plus job narrows to one application", () => {
  const apps = [app("腾讯", "产品经理"), app("腾讯", "后端开发"), app("阿里巴巴", "产品经理")];
  const found = apps.filter((a) => matchApplication(a, "腾讯 产品"));
  assert.deepEqual(found.map((a) => a.title), ["产品经理"]);
  assert.equal(found.length, 1);
  assert.equal(apps.filter((a) => matchApplication(a, "tx cp")).length, 1);
});

test("a single letter only matches initials at the start, not every 银行 in the list", () => {
  assert.ok(matchApplication(app("招商银行", "管培生"), "z"));
  assert.equal(matchApplication(app("招商银行", "管培生"), "y"), null);
  // But typed text still matches anywhere.
  assert.ok(matchApplication(app("招商银行", "管培生"), "银"));
});

test("matched text is highlighted where it is", () => {
  const hits = matchApplication(app("字节跳动", "数据分析师"), "跳动 分析");
  assert.deepEqual(plain(highlightParts("字节跳动", hits.company)), [{ text: "字节", hit: false }, { text: "跳动", hit: true }]);
  assert.deepEqual(plain(highlightParts("数据分析师", hits.title)), [{ text: "数据", hit: false }, { text: "分析", hit: true }, { text: "师", hit: false }]);
  const initialsHit = matchApplication(app("字节跳动", "数据分析师"), "jt");
  assert.deepEqual(plain(highlightParts("字节跳动", initialsHit.company)), [{ text: "字", hit: false }, { text: "节跳", hit: true }, { text: "动", hit: false }]);
  assert.deepEqual(plain(highlightParts("腾讯", [])), [{ text: "腾讯", hit: false }]);
});

test("company names sort in pinyin order", () => {
  const names = ["字节跳动", "阿里巴巴", "百度", "美团", "腾讯", "Apple"];
  assert.deepEqual([...names].sort(compareCompanyNames).filter((name) => name !== "Apple"), ["阿里巴巴", "百度", "美团", "腾讯", "字节跳动"]);
});
