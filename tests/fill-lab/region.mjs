// 框选填写、资料卡点填、拖动框选的实测：在真实 Chromium 里用共享引擎跑 fill lab 的仿真页。
// 全部是虚构资料。  node tests/fill-lab/region.mjs
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const core = require("../../electron/autofill-core.js");
const LAB = path.dirname(fileURLToPath(import.meta.url)), VENDOR = path.join(LAB, ".vendor");
// The same fictional applicant as run.mjs.
const src = fs.readFileSync(path.join(LAB, "run.mjs"), "utf8");
const PROFILE = eval("(" + src.slice(src.indexOf("const PROFILE = ") + 16, src.indexOf("};\n\nconst server") + 1) + ")");
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, "http://x").pathname); const f = p.startsWith("/vendor/") ? path.join(VENDOR, p.slice(8)) : path.join(LAB, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": f.endsWith(".html") ? "text/html; charset=utf-8" : f.endsWith(".css") ? "text/css" : "application/javascript" }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
let fails = 0; const ok = (c, m) => { console.log(c ? "✓" : "✗", m); if (!c) fails++; };
function adapter(page) {
  return { url: () => page.url(), stillOnPage: (u) => page.url() === u, taskId: "t", frames: async () => page.frames(),
    run: (frame, fn, args = []) => frame.evaluate(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`),
    api: async (n) => n.startsWith("profile") ? { ok: true, json: async () => structuredClone(PROFILE) } : n === "answer-questions" ? { ok: true, json: async () => ({ answers: [] }) } : { ok: false, json: async () => ({}) },
    status: () => {}, uploadResume: async () => { throw new Error("no upload in region"); }, getDrafts: () => [], setDrafts: () => {}, getPlan: () => null, setPlan: async () => {}, archiveScope: () => "x",
    frameOffset: async (frame) => { const box = await (await frame.frameElement()).boundingBox(); return box && { x: box.x, y: box.y }; } };
}
async function open(name) { const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); await page.goto(`${base}/pages/${name}.html`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(1200); for (const f of page.frames()) await f.evaluate(`document.documentElement.setAttribute("data-cp-task","t")`).catch(() => {}); return page; }
const around = async (frame, selA, selB, offset = { x: 0, y: 0 }) => { const a = await frame.locator(selA).first().boundingBox(); const b = await frame.locator(selB).first().boundingBox(); return { x: 0, y: a.y - 4, width: 1280, height: b.y + b.height - a.y + 8 }; };

// (a) top frame: only 校园经历, previewed then filled directly
{ const page = await open("campus");
  const region = await around(page, "#c1", "#c6");
  const r = await core.runAutofillCore(adapter(page), "resume-1", { mode: "preview", region, modules: core.AUTOFILL_MODULES });
  const labels = r.plan?.proposals.map((p) => p.label) || [];
  ok(r.phase === "preview" && labels.length === 6 && labels.every((l) => /组织|职务|级别|时间|描述/.test(l)), `campus 预览只列框内 6 项：${labels.join("、")}`);
  ok(r.plan?.uploadResume === false, "框选时不上传简历");
  const d = await core.runAutofillCore(adapter(page), "resume-1", { region, modules: core.AUTOFILL_MODULES });
  ok(await page.inputValue("#c1") === "复旦大学研究生会" && await page.inputValue("#b1") === "" && await page.inputValue("#e3") === "", `直接填：框内填上、框外没动（${d.phase}）`);
  // (c) 资料卡 点填
  await page.evaluate(`(${core.trackUserEdits.toString()})()`);
  await page.click("#b1");
  const ins = await page.evaluate(`(${core.insertIntoLastField.toString()})("林晓舟")`);
  ok(ins.ok && await page.inputValue("#b1") === "林晓舟", "点框后资料卡填入到那个框");
  await page.click("#b5"); await page.keyboard.type("因果");
  await page.evaluate(`(${core.insertIntoLastField.toString()})("推断")`);
  ok(await page.inputValue("#b5") === "因果推断", `插在光标处而不是覆盖：${await page.inputValue("#b5")}`);
  await page.click("#b6"); await page.waitForTimeout(600); await page.click("#b4");
  const sel = await page.evaluate(`(${core.insertIntoLastField.toString()})("是")`);
  ok(!sel.ok && await page.inputValue("#b6") === "", `点了下拉框之后不往上一个框里填：${sel.reason}`);
  await page.click("label[for], h3"); 
  // (d) drag picker
  const picking = page.evaluate(`(${core.pickPageRegion.toString()})()`);
  await page.waitForTimeout(200); await page.mouse.move(100, 100); await page.mouse.down(); await page.mouse.move(400, 300, { steps: 5 }); await page.mouse.up();
  const rect = await picking;
  ok(rect && rect.x === 100 && rect.width === 300 && !(await page.$("#cp-region-picker")), `拖动框选得到 ${JSON.stringify(rect)}，遮罩已移除`);
  const esc = page.evaluate(`(${core.pickPageRegion.toString()})()`); await page.waitForTimeout(200); await page.keyboard.press("Escape");
  ok(await esc === null, "Esc 取消");
  await page.close(); }

// (b) iframe page: only 第二段教育经历
{ const page = await open("element-beisen");
  const inner = page.frames().find((f) => f.url().includes("element-inner"));
  const subs = inner.locator(".sub-title");
  const second = await subs.nth(1).boundingBox();
  const box = await (await inner.frameElement()).boundingBox();
  // From the 第二段 title down to the next section title after it.
  const after = await inner.evaluate(() => { const t = [...document.querySelectorAll(".sub-title, .section-title, h3, h4, legend")]; const i = t.findIndex((el) => el.textContent.includes("第二段")); const n = t.slice(i + 1).find((el) => el.getBoundingClientRect().top > t[i].getBoundingClientRect().bottom + 20); return n ? n.getBoundingClientRect().top : t[i].getBoundingClientRect().top + 400; });
  const region = { x: 0, y: box.y + second.y - 4, width: 1280, height: after - second.y };
  const r = await core.runAutofillCore(adapter(page), "resume-1", { mode: "preview", region, modules: core.AUTOFILL_MODULES });
  const props = r.plan?.proposals || [];
  ok(r.phase === "preview" && props.length > 0, `iframe 里框选：${r.phase} ${r.message?.slice(0, 40)} ${props.length} 项`);
  console.log("   ", props.map((p) => `${p.label}=${p.value}`).join(" | "));
  ok(props.some((p) => p.value === "南京大学") && !props.some((p) => p.value === "复旦大学"), "框的是第二段，用的是第二段经历（南京大学）");
  await page.close(); }

// empty region
{ const page = await open("campus");
  const r = await core.runAutofillCore(adapter(page), "resume-1", { mode: "preview", region: { x: 0, y: 0, width: 30, height: 30 }, modules: core.AUTOFILL_MODULES });
  ok(r.phase === "error" && /框住的地方没有/.test(r.message), `空区域：${r.message}`); await page.close(); }
await browser.close(); server.close();
console.log(fails ? `${fails} 项失败` : "全部通过"); process.exit(fails ? 1 : 0);
