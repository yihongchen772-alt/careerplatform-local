const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../electron/autofill-core.js");

// The fill lab (feishu-v40, zhiye-phoenix) exercises these in Chromium; CI has no
// browser, so this keeps the two date-box rules from being dropped unnoticed.
test("飞书's Universe Design date box goes through the commit-on-blur picker path", () => {
  const fill = core.fillFields.toString();
  assert.match(fill, /const PICKER = "[^"]*\.ud__picker/);
  assert.match(fill, /const LIBRARY_PICKER = "[^"]*\.ud__picker/);
  assert.match(core.scanPageFields.toString(), /const PICKER = "[^"]*\.ud__picker/);
});

test("a 北森 calendar showing 「Invalid date」 is not taken as filled", () => {
  const custom = core.fillCustomSelects.toString();
  assert.match(custom, /invalid\|nan/);
  assert.match(custom, /phoenix-select__clearIcon/);
});

test("award dates written as 2023.5.20 / 2023.5 still give the year and month", () => {
  assert.equal(core.formatDateForField({ placeholder: "YYYY", label: "获奖时间" }, "2023.5.20"), "2023");
  assert.equal(core.formatDateForField({ placeholder: "", label: "获奖时间" }, "2023.5"), "2023-05");
  assert.equal(core.formatDateForField({ placeholder: "YYYY-MM-DD", label: "获奖时间" }, "2023.5.20"), "2023-05-20");
});
