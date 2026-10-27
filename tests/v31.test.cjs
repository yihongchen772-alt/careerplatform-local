const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/autofill-core.js");

const CITIES = "上海,苏州，杭州、深圳 南京";
const field = (label, placeholder = "请输入") => ({ id: "c1", tag: "input", type: "text", label, placeholder, name: "", section: "个人信息" });

test("期望工作地 says 「只能填写一个城市」: only the first saved city goes in", () => {
  assert.equal(core.matchBasicField(field("期望工作地（提示：只能填写一个城市）"), { preferredCities: CITIES }, new Map()), "上海");
});

test("「最多3个,空格隔开」: three cities, joined by a space", () => {
  assert.equal(core.citiesForField(field("意向城市", "例：浙江杭州(最多3个,空格隔开)"), CITIES), "上海 苏州 杭州");
  assert.equal(core.citiesForField(field("意向城市", "最多选择两个城市，用顿号分隔"), CITIES), "上海、苏州");
  assert.equal(core.citiesForField(field("期望城市", "不超过2个"), CITIES), "上海,苏州");
});

test("a city box that names no limit keeps the list as saved; a named separator is followed", () => {
  assert.equal(core.citiesForField(field("工作地点"), CITIES), CITIES);
  assert.equal(core.citiesForField(field("期望城市", "多个城市用逗号隔开"), CITIES), "上海,苏州,杭州,深圳,南京");
  assert.equal(core.citiesForField(field("期望工作地（只能填写一个城市）"), "上海"), "上海", "one saved city stays as is");
});

test("the city limit does not leak into other rules", () => {
  assert.equal(core.matchBasicField(field("现居城市"), { currentCity: "上海", preferredCities: CITIES }, new Map()), "上海");
});
