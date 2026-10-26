const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 查看投递: the city a 投递 is in, and laying the list out by company / city / week.
const cache = {};
function loadTs(relative) {
  if (cache[relative]) return cache[relative];
  const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const localRequire = (name) => (name.startsWith("@/") ? loadTs(`src/${name.slice(2)}.ts`) : require(name));
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: localRequire, Intl, Date, Math }, { filename: relative });
  return (cache[relative] = mod.exports);
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const city = loadTs("src/lib/application-city.ts");
const groups = loadTs("src/lib/application-groups.ts");

test("a 岗位's location is read as the cities it names", () => {
  assert.deepEqual(plain(city.parseCities("北京市")), ["北京"]);
  assert.deepEqual(plain(city.parseCities("广东省-江门")), ["江门"]);
  assert.deepEqual(plain(city.parseCities("上海市金山区")), ["上海"]);
  assert.deepEqual(plain(city.parseCities("天津市滨海新区")), ["天津"]);
  assert.deepEqual(plain(city.parseCities("深圳,上海,北京,长春")), ["深圳", "上海", "北京", "长春"]);
  assert.deepEqual(plain(city.parseCities("广州、苏州太仓、天津、上海、成都")), ["广州", "苏州", "天津", "上海", "成都"]);
  assert.deepEqual(plain(city.parseCities("呼和浩特市、天津市、无锡市、银川市")), ["呼和浩特", "天津", "无锡", "银川"]);
  assert.deepEqual(plain(city.parseCities("")), []);
  assert.deepEqual(plain(city.parseCities(null)), []);
});

test("a place not on the list is kept as written, not dropped", () => {
  assert.deepEqual(plain(city.parseCities("鹰潭市")), ["鹰潭"]);
  assert.deepEqual(plain(city.parseCities("广东")), ["广东"]);
  assert.deepEqual(plain(city.parseCities("Remote")), []);
});

test("a title that names a city gives it; one that does not gives none", () => {
  assert.deepEqual(plain(city.citiesInTitle("上海校招正式技术 - 算法类")), ["上海"]);
  assert.deepEqual(plain(city.citiesInTitle("底盘算法工程师（2027届-南京）")), ["南京"]);
  assert.deepEqual(plain(city.citiesInTitle("北京、深圳校招正式技术 - 算法类")), ["北京", "深圳"]);
  assert.deepEqual(plain(city.citiesInTitle("机器人运动控制算法工程师")), []);
});

test("a city set by hand wins, then the 岗位, then the title", () => {
  const both = { title: "算法工程师（上海）", location: "北京市" };
  assert.deepEqual(plain(city.applicationCities({ ...both, city: "杭州" })), ["杭州"]);
  assert.deepEqual(plain(city.applicationCities(both)), ["北京"]);
  assert.deepEqual(plain(city.applicationCities({ title: "算法工程师（上海）" })), ["上海"]);
  assert.deepEqual(plain(city.applicationCities({ title: "算法工程师", location: " " })), []);
});

test("three or more cities share one group; none is its own", () => {
  assert.equal(city.cityGroup(["上海"]), "上海");
  assert.equal(city.cityGroup(["北京", "深圳"]), "北京");
  assert.equal(city.cityGroup(["北京", "深圳", "杭州"]), "多城市");
  assert.equal(city.cityGroup([]), "未标城市");
  assert.equal(city.cityText(["北京", "深圳"]), "北京 · 深圳");
  assert.equal(city.cityText(["北京", "深圳", "杭州", "成都"]), "北京 等 4 城");
});

// 2026-10-26 is a Monday.
const NOW = new Date(2026, 9, 26, 15, 0).getTime();
const at = (month, day) => new Date(2026, month - 1, day, 9, 0).toISOString();
const row = (id, company, cities, applied) => ({ id, company, cities, appliedDate: applied });
const of = (item) => item.company;

test("by company: several 岗位 each get a section, the singles share one in pinyin order", () => {
  const rows = [
    row(1, "字节跳动", [], at(10, 20)), row(2, "百度", [], at(10, 21)), row(3, "字节跳动", [], at(10, 22)),
    row(4, "阿里巴巴", [], at(10, 23)), row(5, "百度", [], at(10, 24)), row(6, "字节跳动", [], at(10, 25)), row(7, "华为", [], at(10, 25)),
  ];
  const result = groups.groupApplications(rows, "company", NOW, of);
  assert.deepEqual(plain(result.map((g) => [g.label, g.items.map((i) => i.id)])), [
    ["字节跳动", [1, 3, 6]],
    ["百度", [2, 5]],
    ["只投了 1 个岗位的公司", [4, 7]],
  ]);
  assert.equal(result[2].hint, "2 家");
});

test("by city: biggest first, 多城市 and 未标城市 last, and the list's own order inside", () => {
  const rows = [
    row(1, "a", ["上海"], at(10, 20)), row(2, "b", [], at(10, 21)), row(3, "c", ["北京"], at(10, 22)),
    row(4, "d", ["上海"], at(10, 23)), row(5, "e", ["北京", "深圳", "杭州"], at(10, 24)), row(6, "f", ["上海", "苏州"], at(10, 25)),
  ];
  const result = groups.groupApplications(rows, "city", NOW, of);
  assert.deepEqual(plain(result.map((g) => [g.label, g.items.map((i) => i.id)])), [
    ["上海", [1, 4, 6]], ["北京", [3]], ["多城市", [5]], ["未标城市", [2]],
  ]);
});

test("by week: this week, last week, then dated weeks, newest first; far back it is a month", () => {
  const rows = [
    row(1, "a", [], at(10, 26)), row(2, "b", [], at(10, 25)), row(3, "c", [], at(10, 19)),
    row(4, "d", [], at(10, 14)), row(5, "e", [], at(9, 30)), row(6, "f", [], at(8, 12)), row(7, "g", [], at(8, 3)),
  ];
  const result = groups.groupApplications(rows, "week", NOW, of);
  assert.deepEqual(plain(result.map((g) => [g.label, g.items.map((i) => i.id)])), [
    ["本周", [1]], ["上周", [2, 3]], ["10/12 – 10/18", [4]], ["9/28 – 10/4", [5]], ["2026 年 8 月", [6, 7]],
  ]);
  // Weeks run Monday to Sunday: Sunday 10/25 and Monday 10/19 are both 上周.
  assert.equal(result[1].hint, "10/19 – 10/25");
});

test("the time window counts calendar days from the day it was sent", () => {
  const within = (iso, window) => groups.inTimeWindow(iso, window, NOW);
  assert.equal(within(at(10, 26), "today"), true);
  assert.equal(within(at(10, 25), "today"), false);
  assert.equal(within(at(10, 24), "3d"), true);
  assert.equal(within(at(10, 23), "3d"), false);
  assert.equal(within(at(10, 20), "7d"), true);
  assert.equal(within(at(10, 19), "7d"), false);
  assert.equal(within(at(9, 27), "30d"), true);
  assert.equal(within(at(9, 26), "30d"), false);
  assert.equal(within(at(1, 1), "all"), true);
  // A date a little ahead (set by hand) still counts as recent.
  assert.equal(within(at(10, 28), "today"), true);
});

test("a month can be picked, and the menu lists only months that have 投递", () => {
  assert.equal(groups.inTimeWindow(at(9, 30), "m:2026-09", NOW), true);
  assert.equal(groups.inTimeWindow(at(10, 1), "m:2026-09", NOW), false);
  assert.deepEqual(plain(groups.monthsPresent([at(10, 3), at(9, 30), at(10, 9), at(8, 1)])), ["m:2026-10", "m:2026-09", "m:2026-08"]);
  assert.equal(groups.monthLabel("m:2026-09"), "2026 年 9 月");
  assert.equal(groups.parseTime("m:2026-09"), "m:2026-09");
  assert.equal(groups.parseTime("bogus"), "all");
  assert.equal(groups.parseTime(null), "all");
});

test("a city the title already says is not shown a second time", () => {
  assert.equal(city.cityHint(["上海"], "上海校招正式技术 - 算法类"), "");
  assert.equal(city.cityHint(["上海"], "算法工程师"), "上海");
  assert.equal(city.cityHint(["北京", "深圳"], "北京校招 - 算法类"), "深圳");
  assert.equal(city.cityHint([], "算法工程师"), "");
});

test("a company named 「城市+市…」 is in that city; a brand that merely contains one is not", () => {
  assert.deepEqual(plain(city.cityInCompanyName("深圳市雷赛智能控制股份有限公司")), ["深圳"]);
  assert.deepEqual(plain(city.cityInCompanyName("上海市某某科技")), ["上海"]);
  assert.deepEqual(plain(city.cityInCompanyName("上海电气")), []);
  assert.deepEqual(plain(city.cityInCompanyName("北京现代")), []);
  assert.deepEqual(plain(city.cityInCompanyName("深圳")), []);
  // Last resort: a title or location that names a place beats the company's name.
  assert.deepEqual(plain(city.applicationCities({ title: "算法工程师", companyName: "深圳市雷赛智能控制股份有限公司" })), ["深圳"]);
  assert.deepEqual(plain(city.applicationCities({ title: "算法工程师（上海）", companyName: "深圳市雷赛智能控制股份有限公司" })), ["上海"]);
});
