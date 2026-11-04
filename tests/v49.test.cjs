const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../electron/autofill-core.js");

const field = (label, extra = {}) => ({ id: "x", tag: "input", type: "text", label, placeholder: "", name: "", section: "", ...extra });
const profile = {
  education: [{ school: "复旦大学", major: "统计学", degree: "硕士", start: "2024-09", end: "2099-06" }],
  experiences: [], projects: [], awards: [], campus: [], skills: [], languages: [],
  currentCity: "上海", latestCompany: "示例公司", birthDate: "2002-03-15", rank: "前 10%", hometown: "江苏南京",
  householdPlace: "江苏省南京市", sourcePlace: "江苏南京", marital: "未婚", height: "168", partyDate: "2021-06", onlyChild: "是",
  emergencyName: "林甲", emergencyRelation: "父亲", emergencyPhone: "13900000000", advisor: "王教授", relativeInCompany: "无",
  family: [{ relation: "父亲", name: "林甲", birthDate: "1970-05", politics: "群众", employer: "示例电力", position: "工程师", phone: "" }, { relation: "母亲", name: "陈乙", birthDate: "1972-01", politics: "群众", employer: "示例中学", position: "教师", phone: "" }],
};

test("Moka 的 年 / 月 下拉各取日期的一段，月份不补零也接受别家的写法", () => {
  assert.deepEqual(core.customDatePart({ datePart: "year" }, "2024-09"), { value: "2024", alternatives: ["2024年"] });
  const month = core.customDatePart({ datePart: "month" }, "2024-09");
  assert.equal(month.value, "9");
  assert.ok(month.alternatives.includes("09") && month.alternatives.includes("9月"));
  assert.equal(core.customDatePart({ datePart: "month" }, "2024"), null, "只有年份时月份不瞎编");
});

test("工作经验是下拉时是年限选项，不是经历本身", () => {
  assert.equal(core.matchBasicField(field("工作经验", { tag: "custom-select" }), profile, new Map()), "应届生");
  assert.equal(core.matchBasicField(field("工作经验", { tag: "custom-select", options: ["在校生", "应届毕业生", "1 年"] }), profile, new Map()), "应届毕业生");
});

test("出生日期 (年龄) 是日期，不是年龄数字", () => {
  assert.match(String(core.matchBasicField(field("出生日期 (年龄)"), profile, new Map())), /^2002-03/);
});

test("所在地、最近公司有规则；工作所在地不算本人现居", () => {
  assert.equal(core.matchBasicField(field("所在地"), profile, new Map()), "上海");
  assert.equal(core.matchBasicField(field("最近公司"), profile, new Map()), "示例公司");
  assert.notEqual(core.matchFlatField(field("工作所在地"), profile), "上海");
});

test("学历类型不是学历本身，看到选项后能配上", () => {
  const options = ["全日制", "非全日制", "全日制硕士"];
  assert.equal(core.matchBasicField(field("学历类型", { section: "教育经历", options }), profile, new Map()), "全日制");
  assert.equal(core.matchBasicField(field("成绩排名", { options: ["前5%", "前10%", "前20%"] }), profile, new Map()), "前10%");
});

test("央国企个人信息各有去处，户籍不再落到籍贯", () => {
  assert.equal(core.matchFlatField(field("户籍所在地"), profile), "江苏省南京市");
  assert.equal(core.matchFlatField(field("生源地"), profile), "江苏南京");
  assert.equal(core.matchFlatField(field("婚姻状况"), profile), "未婚");
  assert.equal(core.matchFlatField(field("身高"), profile), "168");
  assert.equal(core.matchFlatField(field("入党时间"), profile), "2021-06");
  assert.equal(core.matchFlatField(field("籍贯"), profile), "江苏南京");
  assert.equal(core.isThirdPartyField(field("是否独生子女")), false);
});

test("他人信息：存过的照填，没存的不猜，也不拿申请人自己的", () => {
  const rows = () => new Map();
  assert.equal(core.savedThirdPartyValue(field("姓名", { section: "紧急联系人" }), profile, rows()), "林甲");
  assert.equal(core.savedThirdPartyValue(field("与本人关系", { section: "紧急联系人" }), profile, rows()), "父亲");
  assert.equal(core.savedThirdPartyValue(field("导师姓名"), profile, rows()), "王教授");
  assert.equal(core.savedThirdPartyValue(field("母亲工作单位"), profile, rows()), "示例中学");
  const table = rows();
  assert.equal(core.savedThirdPartyValue(field("姓名", { section: "家庭主要成员" }), profile, table), "林甲");
  assert.equal(core.savedThirdPartyValue(field("姓名", { section: "家庭主要成员" }), profile, table), "陈乙");
  assert.equal(core.savedThirdPartyValue(field("姓名", { section: "家庭主要成员" }), profile, table), null, "第三行没有资料");
  assert.equal(core.savedThirdPartyValue(field("推荐人姓名"), profile, rows()), null);
  assert.equal(core.savedThirdPartyValue(field("姓名", { section: "紧急联系人" }), { family: [] }, rows()), null);
});

test("身份证等仍不自动填", () => {
  assert.equal(core.isNeverGuessField(field("身份证号")), true);
});

test("家人、联系人、身高这类私密信息不进给 AI 的资料描述", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/application-profile.ts"), "utf8");
  assert.match(source, /PERSONAL_FIELDS\.filter\(\(field\) => !\("private" in field\)\)/);
  for (const key of ["marital", "height", "emergencyPhone", "advisor"]) assert.match(source, new RegExp(`key: "${key}"[^\\n]*private: true`));
  assert.doesNotMatch(source.slice(source.indexOf("describeApplicationProfile")), /p\.family|\.family\b/);
});

test("保存资料时家庭成员没被丢掉", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib/actions/account.ts"), "utf8");
  assert.match(source, /family: data\.family\.filter/);
  const route = fs.readFileSync(path.join(__dirname, "../src/app/api/desktop-browser/profile/route.ts"), "utf8");
  assert.match(route, /PERSONAL_FIELDS\.map/);
  assert.match(route, /family: structured\.family/);
});

test("飞书的家乡按籍贯填", () => {
  assert.equal(core.matchFlatField(field("家乡"), profile), "江苏南京");
});

test("现工作城市是现在在哪，不是期望城市", () => {
  assert.equal(core.matchFlatField(field("现工作城市"), { ...profile, preferredCities: "北京" }), "上海");
  assert.equal(core.matchFlatField(field("期望工作城市"), { ...profile, preferredCities: "北京" }), "北京");
});

test("语言等级一样近时往上取：六级不是入门", () => {
  assert.equal(core.resolveRepeatField && core.skillLevelOption?.({ options: ["入门", "熟练", "精通", "母语"] }, "良好"), "熟练");
});

test("正常填完不会把字段算成写入失败", async () => {
  const fields = [{ id: "x-f0", tag: "input", label: "姓名" }];
  const frameById = new Map([["x-f0", "top"]]);
  const adapter = { stillOnPage: () => true, run: async (_f, fn) => fn === core.fillFields ? { filled: ["x-f0"], failed: [], skipped: [] } : [] };
  const result = await core.fillFrames(adapter, [{ id: "x-f0", value: "林晓舟", label: fields[0].label }], frameById, "u");
  assert.deepEqual(result.filled, ["x-f0"]);
  assert.deepEqual(result.failed, []);
});

test("表单重建后按字段身份认回来接着填", async () => {
  const frameById = new Map([["x-f0", "top"]]);
  frameById.mappingKeys = new Map([["x-f0", "基本|姓名|input||0"]]);
  let calls = 0;
  const adapter = { stillOnPage: () => true, run: async (_f, fn, args) => {
    if (fn === core.scanPageFields) return [{ id: "r-f9", mappingKey: "基本|姓名|input||0", hasValue: false }];
    if (fn === core.fillFields) { calls++; return calls === 1 ? { filled: [], failed: [], skipped: [], missing: [args[0][0].id] } : { filled: [args[0][0].id], failed: [], skipped: [] }; }
    return [];
  } };
  const result = await core.fillFrames(adapter, [{ id: "x-f0", value: "林晓舟", label: "姓名" }], frameById, "u");
  assert.deepEqual(result.filled, ["x-f0"], "报告里还是原来的字段");
  assert.deepEqual(result.failed, []);
});

