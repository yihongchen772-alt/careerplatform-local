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

const city = load("src/lib/application-city.ts");
// Values from the vm realm compare as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

// Shapes of real job pages (synthetic text): the place sits under the title, often unlabeled.
test("a job page's city is read from the line of places under its title", () => {
  const cases = [
    ["首页\n机器人算法工程师（2027届）(J1)\n校园招聘\n全职\n浙江省·杭州市\n硕士研究生\n工作职责\n1. 参与上海项目", ["杭州"]],
    ["2027届-嵌入式工程师\n分享\n上海市|智能制造\n发布于 2026-09-16", ["上海"]],
    ["机器人学习算法工程师\n正式\n算法与软件\n上海嘉定区\n职位描述\n…", ["上海"]],
    ["算法工程师-强化学习\n信息技术类\n应届生\n佛山市、上海市\n分享", ["佛山", "上海"]],
    ["算法研发岗\n北京市、杭州市、潍坊市、新加坡2026-10-28更新本科及以上招聘若干人", ["北京", "杭州", "潍坊", "新加坡"]],
    ["岗位职责：负责测试\n工作地点：江苏省苏州市工业园区\n要求", ["苏州"]],
    ["工作地点\n宁德市\n岗位职责", ["宁德"]],
  ];
  for (const [text, expected] of cases) assert.deepEqual(plain(city.cityFromJobText(text)), expected, text);
  // A footer address or a subtitle that only starts with a city is not the job's place.
  assert.deepEqual(plain(city.cityFromJobText("首页\n地址：深圳市南山区\n热门职位")), []);
  assert.deepEqual(plain(city.cityFromJobText("测试开发工程师\n上海电气集团 - 软件测试\n职位描述")), []);
  assert.deepEqual(plain(city.cityFromJobText("首页\n北京实验室开放日\n职位描述")), []);
});

test("only one job's own page is opened, and only when it shows that job", () => {
  assert.equal(city.isJobPageUrl("https://dobot.zhiye.com/campus/detail?jobAdId=1"), true);
  assert.equal(city.isJobPageUrl("https://job.example.com/portal/pc/#/personalCenter/myApply"), false);
  assert.equal(city.isJobPageUrl("https://x.zhiye.com/campus/jobs"), false);
  assert.equal(city.isJobPageUrl("https://join.example.com/progress.html"), false);
  assert.equal(city.pageShowsTitle("算法工程师-强化学习\n佛山市", "强化学习"), true);
  assert.equal(city.pageShowsTitle("登录 / 注册\n欢迎", "机器人运动控制算法工程师"), false);
});

test("districts and a company's (城市) count as a city", () => {
  assert.deepEqual(plain(city.citiesInTitle("网络部-算力客户支撑及运维管理-昌平区信息港")), ["北京"]);
  assert.deepEqual(plain(city.citiesInTitle("高新区研发岗")), []);
  assert.deepEqual(plain(city.cityInCompanyName("博凯机械（上海）有限公司")), ["上海"]);
  assert.deepEqual(plain(city.cityInCompanyName("上海电气")), []);
  assert.deepEqual(plain(city.applicationCities({ title: "现场服务工程师", companyName: "某某（北京）科技有限公司" })), ["北京"]);
});
