const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const core = require("../electron/autofill-core.js");

test("资料卡 fills the box last clicked into, at the caret, and never one clicked away from", () => {
  for (const name of ["insertIntoLastField", "lastFieldFocusAt", "pickPageRegion", "fieldIdsInRect", "iframeOffsets"]) assert.equal(typeof core[name], "function", name);
  const source = core.insertIntoLastField.toString();
  assert.match(source, /execCommand\("insertText"/, "typed like keystrokes, so ⌘Z undoes it");
  assert.match(source, /clickedAway/);
  assert.match(source, /el\.disabled \|\| el\.readOnly/);
  assert.match(core.trackUserEdits.toString(), /__cpLastFocus[\s\S]*__cpLastPointer/);
  const view = read("electron/browser-view.js");
  assert.match(view, /handle\("browser:insert-profile-value"/);
  assert.match(read("electron/preload.js"), /insertProfileValue: \(value\) => ipcRenderer\.invoke\("browser:insert-profile-value", value\)/);
  // No box picked: copied instead, so the card is never a dead end.
  const panel = read("src/components/browser/application-assistant.tsx");
  assert.match(panel, /insertProfileValue\(card\.value\)[\s\S]*copyText\(card\.value\)/);
});

test("框选填写 previews only the fields in the box, keeps row order, and adds nothing else", () => {
  const run = core.runAutofillCore.toString();
  assert.match(run, /options\.region \? await fieldsInRegion\(adapter, options\.region\)/);
  // Outside fields are skipped after classification, so the second block still gets the second row.
  assert.match(run, /classifyRepeatBlocks\([\s\S]*inRegion && !inRegion\.has\(field\.id\)/);
  assert.match(run, /if \(options\.region\) modules\.delete\("resume"\)/);
  assert.match(run, /options\.expandBlocks && !options\.region/);
  assert.match(run, /框住的地方没有可以填的输入框/);
  const browser = read("src/components/browser/embedded-browser.tsx");
  // The panel opens before the box is drawn, since opening it moves the page.
  assert.match(browser, /openPanel\("preview"\);\s*await new Promise[\s\S]*?pickRegion\(\)/);
  assert.match(browser, /框选一块区域填写/);
});

test("暂停 keeps what is filled and 继续填写 runs the same fill for the rest", () => {
  const view = read("electron/browser-view.js");
  assert.match(view, /const PAUSED = "已暂停填写，已填入的内容保留";/);
  assert.match(view, /!\/已停止\|已暂停\/\.test/, "a pause is not counted as an error in 填写统计");
  const browser = read("src/components/browser/embedded-browser.tsx");
  assert.match(browser, /if \(extra\.mode !== "preview"\) lastFill\.current = extra;/);
  assert.match(browser, /status\.message\.startsWith\("已暂停"\)[\s\S]*handleAutofill\(lastFill\.current\)[\s\S]*继续填写/);
  // The core reports the stop reason over whatever error the abort raised.
  assert.match(core.runAutofillCore.toString(), /message: adapter\.stopReason\?\.\(\) \|\|/);
});
