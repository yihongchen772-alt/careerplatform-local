const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const read = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
function loadTs(relative) {
  const compiled = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  // Same realm as the test, so arrays and objects compare structurally.
  vm.runInThisContext(`(function (module, exports, require) {${compiled}\n})`, { filename: relative })(mod, mod.exports, require);
  return mod.exports;
}

const R = loadTs("src/lib/resume-doc.ts");
const { photoFromPdf } = loadTs("src/lib/resume-photo.ts");

// A made-up resume in the shape the reading AI returns.
const parsed = {
  name: "张三",
  headline: "数据分析师 | 2027 届毕业生",
  contacts: ["电话：13800000000 | 邮箱：test@example.com", ""],
  hasPhoto: true,
  sections: [
    { heading: "教育背景", layout: "entries", columns: 1, entries: [{ title: "某某大学", subtitle: "统计学 硕士", date: "2025.09 – 2027.06", tags: "", lines: ["核心课程：回归分析、机器学习、数据库"], bullets: [] }], items: [] },
    {
      heading: "项目经历",
      layout: "entries",
      columns: 1,
      entries: [
        { title: "用户留存分析", subtitle: "| 课程项目", date: "2026.03 – 2026.06", tags: "Python / SQL", lines: [], bullets: ["用 **Python** 清洗 3 万条日志，搭建留存看板", "撰写分析报告"] },
        { title: "销量预测", subtitle: "| 竞赛", date: "2025.10", tags: "", lines: [], bullets: ["建立回归模型，误差降低 12%"] },
      ],
      items: [],
    },
    { heading: "荣誉奖项", layout: "list", columns: 2, entries: [], items: ["校一等奖学金", "数学建模省二等奖"] },
    { heading: "空板块", layout: "lines", columns: 1, entries: [], items: [] },
    { heading: "", layout: "weird", columns: 3, entries: [], items: ["没有标题的板块会被丢掉"] },
  ],
};

test("底稿: the parsed resume gets stable ids, empty parts dropped, odd values tamed", () => {
  const doc = R.docFromParsed(parsed, null);
  assert.equal(doc.sections.length, 3);
  assert.deepEqual(doc.sections.map((s) => s.id), ["s1", "s2", "s3"]);
  assert.deepEqual(doc.contacts.map((c) => c.id), ["c1"]);
  assert.equal(doc.sections[1].entries[0].id, "e2");
  assert.deepEqual(doc.sections[1].entries[0].bullets.map((b) => b.id), ["p2", "p3"]);
  assert.equal(doc.sections[2].columns, 2);
  assert.equal(doc.fontScale, 1);
  // Only a data: image survives as the photo.
  assert.equal(R.docFromParsed(parsed, "javascript:alert(1)").photo, null);
  assert.match(R.docFromParsed(parsed, "data:image/jpeg;base64,/9j/AAAA").photo, /^data:image\/jpeg/);
});

test("addresses read and write every kind of text, and leave unknown ones alone", () => {
  const doc = R.docFromParsed(parsed, null);
  assert.equal(R.textAt(doc, "headline"), "数据分析师 | 2027 届毕业生");
  assert.equal(R.textAt(doc, "e2.tags"), "Python / SQL");
  assert.equal(R.textAt(doc, "s2.heading"), "项目经历");
  assert.equal(R.textAt(doc, "p2"), "用 **Python** 清洗 3 万条日志，搭建留存看板");
  assert.equal(R.textAt(doc, "e2.nope"), null);
  const edited = R.withText(doc, "p3", "  撰写\n分析报告并汇报  ");
  assert.equal(R.textAt(edited, "p3"), "撰写 分析报告并汇报");
  assert.equal(R.textAt(doc, "p3"), "撰写分析报告", "the original is not mutated");
  assert.equal(R.docPlainText(R.withText(doc, "p999", "x")), R.docPlainText(doc));
  // Enter adds a line after; Backspace on an empty one removes it.
  const { doc: added, id } = R.withParaAfter(doc, "p2", "新的一条");
  assert.deepEqual(R.childrenOf(added, "e2"), ["p2", id, "p3"]);
  assert.deepEqual(R.childrenOf(R.withoutPara(added, id), "e2"), ["p2", "p3"]);
  // Only a true rearrangement reorders.
  assert.deepEqual(R.childrenOf(R.withOrder(doc, "s2", ["e3", "e2"]), "s2"), ["e3", "e2"]);
  assert.deepEqual(R.childrenOf(R.withOrder(doc, "s2", ["e3"]), "s2"), ["e2", "e3"]);
  assert.deepEqual(R.childrenOf(R.withOrder(doc, "s2", ["e3", "e3"]), "s2"), ["e2", "e3"]);
});

test("the page escapes every text, keeps **bold**, and leaves hidden parts out of the PDF", () => {
  let doc = R.docFromParsed(parsed, null);
  doc = R.withText(doc, "p3", "<script>alert(1)</script><img src=x onerror=y> & **重点**");
  doc = R.withHidden(doc, "e3", true);
  const print = R.renderResumeHtml(doc, "测试");
  assert.doesNotMatch(print, /<script|<img src=x/);
  assert.match(print, /&lt;script&gt;/);
  assert.match(print, /<b>重点<\/b>/);
  assert.match(print, /<b>Python<\/b>/);
  assert.doesNotMatch(print, /销量预测/, "a hidden entry is not printed");
  assert.doesNotMatch(print, /data-id|contenteditable|cp-ctl|cp-pageend/);
  const preview = R.renderResumeBody(doc, { editable: true, changed: new Set(["p2"]) });
  assert.match(preview, /data-id="p2" class="cp-changed"/);
  assert.match(preview, /class="entry cp-hidden"[^>]*><button type="button" class="cp-ctl" data-act="show" data-target="e3"/);
  const word = R.renderResumeWord(doc, "测试");
  assert.doesNotMatch(word, /calc\(|var\(--/);
  assert.match(word, /<table width="100%"/);
});

test("edits typed in the preview come back as **bold** text", () => {
  const el = (name, children, style) => ({ nodeType: 1, nodeName: name, textContent: null, childNodes: children, getAttribute: (n) => (n === "style" ? style ?? null : null) });
  const text = (value) => ({ nodeType: 3, nodeName: "#text", textContent: value, childNodes: [] });
  const node = el("LI", [text("负责 "), el("B", [text("数据"), el("STRONG", [text("清洗")])]), el("BR", []), el("SPAN", [text("看板")], "font-weight: 700"), text(" 上线")]);
  assert.equal(R.richFromNode(node), "负责 **数据清洗** **看板** 上线");
});

test("checks: a new number or term is caught, word-level diff marks what changed", () => {
  const corpus = "用 Python 清洗 3 万条日志，误差降低 12%";
  assert.deepEqual(R.introducedNumbers("清洗 5 万条日志，误差降低 12%", corpus), ["5"]);
  assert.deepEqual(R.introducedTerms("用 Python、Spark 和 sql 清洗", corpus + " SQL"), ["Spark"]);
  const parts = R.diffText("负责数据分析", "负责用户数据分析");
  assert.deepEqual(parts.filter((p) => p.kind !== "same"), [{ kind: "ins", text: "用户" }]);
});

test("the AI's answer becomes checked changes: only allowed text, invented facts held back", () => {
  const base = R.docFromParsed(parsed, null);
  const answer = {
    edits: [
      { id: "name", text: "李四", reason: "x" },
      { id: "c1", text: "电话：1", reason: "x" },
      { id: "e2.title", text: "改标题", reason: "x" },
      { id: "p404", text: "不存在", reason: "x" },
      { id: "[headline]", text: "商业分析师（BI） | 2027 届毕业生", reason: "对应岗位名称" },
      { id: "p2", text: "• 用 **Python** 清洗 3 万条用户日志，搭建**留存看板**", reason: "JD 要求数据清洗" },
      { id: "p3", text: "撰写分析报告，覆盖 20 个指标", reason: "量化" },
      { id: "e2.tags", text: "Python / SQL / Tableau", reason: "JD 工具" },
      { id: "p2", text: "重复的编号只取第一条", reason: "x" },
    ],
    order: [{ parent: "s2", children: ["e3", "e2"], reason: "竞赛更相关" }],
  };
  const changes = R.buildTailorChanges(base, answer, "text");
  assert.deepEqual(changes.map((c) => c.address), ["headline", "p2", "p3", "e2.tags"]);
  assert.equal(changes[0].flag, undefined, "the 求职意向 may name the new role");
  assert.equal(changes[1].after, "用 **Python** 清洗 3 万条用户日志，搭建**留存看板**");
  assert.match(changes[2].flag, /20/);
  assert.match(changes[3].flag, /Tableau/);
  assert.ok(changes.every((c) => c.kind === "text"), "text mode never reorders");

  const doc = R.applyTailorChanges(base, changes);
  assert.equal(R.textAt(doc, "p2"), changes[1].after);
  assert.equal(R.textAt(doc, "p3"), "撰写分析报告", "a held change is not applied");
  assert.deepEqual(changes.map((c) => R.changeState(doc, c)), ["applied", "applied", "reverted", "reverted"]);
  const reverted = R.withChange(doc, changes[1], false);
  assert.equal(R.changeState(reverted, changes[1]), "reverted");
  assert.equal(R.changeState(R.withText(doc, "p2", "我自己改的"), changes[1]), "edited");
  assert.deepEqual([...R.changedAddresses(doc, changes)], ["headline", "p2"]);

  const ordered = R.buildTailorChanges(base, { ...answer, order: [...answer.order, { parent: "s1", children: ["e1"] }, { parent: "e2", children: ["p3"] }] }, "order");
  const order = ordered.filter((c) => c.kind === "order");
  assert.equal(order.length, 1);
  assert.deepEqual(R.childrenOf(R.applyTailorChanges(base, ordered), "s2"), ["e3", "e2"]);
});

test("stored drafts are read defensively", () => {
  assert.equal(R.parseDraft(null), null);
  assert.equal(R.parseDraft({ summary: "匹配弹窗的旧建议", rewrites: [] }), null, "no target, no draft");
  const draft = R.parseDraft({ v: 2, target: { company: "某公司", title: "分析师", jdText: "x".repeat(40), url: "javascript:alert(1)" }, doc: { name: 1, sections: "bad" }, changes: [{ kind: "nope" }] });
  assert.equal(draft.target.url, "");
  assert.equal(draft.doc.name, "1");
  assert.deepEqual(draft.doc.sections, []);
  assert.deepEqual(draft.changes, []);
});

test("the photo comes straight out of the PDF: the portrait JPEG, not logos, PNGs or CMYK", () => {
  const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9])]);
  const obj = (n, dict, data) => Buffer.concat([Buffer.from(`${n} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream\nendobj\n", "latin1")]);
  const photo = jpeg(64);
  const pdf = Buffer.concat([
    Buffer.from("%PDF-1.7\n", "latin1"),
    obj(1, "/Type /XObject /Subtype /Image /Width 200 /Height 200 /ColorSpace /DeviceRGB /Filter /DCTDecode", jpeg(300)),
    obj(2, "/Type /XObject /Subtype /Image /Width 288 /Height 431 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", photo),
    obj(3, "/Type /XObject /Subtype /Image /Width 600 /Height 900 /Filter /FlateDecode", Buffer.alloc(50, 1)),
    obj(4, "/Type /XObject /Subtype /Image /Width 600 /Height 900 /ColorSpace /DeviceCMYK /Filter [/DCTDecode]", jpeg(500)),
    Buffer.from("%%EOF\n", "latin1"),
  ]);
  assert.equal(photoFromPdf(pdf), `data:image/jpeg;base64,${photo.toString("base64")}`);
  assert.equal(photoFromPdf(Buffer.from("%PDF-1.7\n%%EOF")), null);
});

test("wiring: migration, PDF printing, entry points, old address", () => {
  const sql = read("prisma/migrations/20261105120000_resume_tailor_v2/migration.sql");
  assert.match(sql, /ALTER TABLE "ResumeVersion" ADD COLUMN "structured" JSONB/);
  assert.match(sql, /"positionId" TEXT,\n/);
  assert.match(sql, /"savedVersionId" TEXT/);
  assert.match(sql, /ON DELETE SET NULL/);
  const bridge = read("electron/render-bridge.js");
  assert.match(bridge, /"\/print-pdf"/);
  assert.match(bridge, /javascript: false, sandbox: true/);
  assert.match(read("src/lib/actions/backup.ts"), /\["savedVersionId", "resumeVersion"\]/);
  assert.match(read("src/components/browser/embedded-browser.tsx"), /按这个岗位定制简历…/);
  assert.match(read("src/app/(dashboard)/resumes/page.tsx"), /按 JD 定制一份/);
  assert.match(read("src/app/(dashboard)/resumes/tailored/page.tsx"), /redirect\(/);
  assert.doesNotMatch(read("src/components/pool/pool-table.tsx"), /resumes\/tailored/);
  // 一键填写 answers read the tailored text, not the stale base.
  assert.match(read("src/lib/actions/resume-tailor.ts"), /extractedText: docPlainText\(draft\.doc\)/);
  // A re-uploaded file drops the 底稿 read from the old one, and its link to a 定制.
  const resumes = read("src/lib/actions/resumes.ts");
  assert.match(resumes, /structured: Prisma\.JsonNull,\n\s+structuredAt: null/);
  assert.match(resumes, /savedVersionId: id \}, data: \{ savedVersionId: null \}/);
});
