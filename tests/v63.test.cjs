const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { DatabaseSync } = require("node:sqlite");
const { PrismaClient } = require("@prisma/client");

// v1.63.3: a company name the user corrects on a 候选池 position stays corrected.

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "..", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: (id) => mocks[id] || (id.startsWith("@/") ? load(`src/${id.slice(2)}.ts`, mocks) : require(id)), console, Date, Error, Buffer, URL, process, setTimeout, clearTimeout, crypto: globalThis.crypto });
  return mod.exports;
}

test("a corrected company name is not filed back under the company it was corrected from", async (t) => {
  const base = path.resolve(__dirname, "../.local-run/v63-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const file = path.join(root, "test.db");
  const sql = new DatabaseSync(file);
  for (const migration of fs.readdirSync(path.resolve(__dirname, "../prisma/migrations")).filter((entry) => /^\d/.test(entry)).sort()) {
    sql.exec(fs.readFileSync(path.resolve(__dirname, "../prisma/migrations", migration, "migration.sql"), "utf8"));
  }
  sql.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${file.replaceAll("\\", "/")}` } } });
  t.after(async () => {
    await db.$disconnect();
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("unsafe cleanup");
    fs.rmSync(root, { recursive: true });
  });
  await db.user.create({ data: { id: "local-user", email: "fixture@local" } });
  await db.company.create({ data: { id: "parent", name: "示例集团" } });
  // The model calls a subsidiary the same company as its parent — what a loose match does.
  let prompts = [];
  const ai = {
    getUserAiConfig: async () => ({ provider: "fixture" }),
    callTextAi: async ({ prompt }) => { prompts.push(prompt); return { matches: [{ newName: "示例子公司", matchedName: "示例集团" }] }; },
  };
  const mocks = {
    "@/lib/db": { db },
    "@/lib/session": { requireUser: async () => ({ id: "local-user" }) },
    "next/cache": { revalidatePath() {} },
    "@/lib/ai-providers": ai,
  };
  const jobs = load("src/lib/actions/positions.ts", mocks);
  const companyOf = async (id) => (await db.position.findUnique({ where: { id }, include: { company: true } })).company.name;

  // AI read 「示例集团」 off the JD; the user typed 「示例子公司」 over it.
  const corrected = await jobs.createPosition({ companyName: "示例子公司", title: "测试工程师" }, undefined, { rejectedCompanyName: "示例集团" });
  assert.equal(await companyOf(corrected), "示例子公司");
  assert.equal(await jobs.positionCompanyName(corrected), "示例子公司");
  assert.equal(await db.companyAlias.count(), 0, "no alias back to the rejected company");
  assert.match(prompts[0], /母公司和子公司/, "the prompt no longer counts a subsidiary as the same company");

  // Not a correction: an AI match still files variants under one company (and remembers it).
  await db.position.deleteMany({});
  await db.company.deleteMany({ where: { name: "示例子公司" } });
  const merged = await jobs.createPosition({ companyName: "示例子公司", title: "算法工程师" });
  assert.equal(await companyOf(merged), "示例集团");
  assert.equal(await db.companyAlias.count({ where: { alias: "示例子公司", companyId: "parent" } }), 1);

  // Editing that position's name to the same text is the user saying it is not 示例集团:
  // the remembered alias goes and the position moves.
  await jobs.updatePosition(merged, { companyName: "示例子公司" });
  assert.equal(await companyOf(merged), "示例子公司");
  assert.equal(await db.companyAlias.count({ where: { alias: "示例子公司" } }), 0);

  // An edit that keeps the company's own name leaves it where it is.
  const kept = await jobs.createPosition({ companyName: "示例集团", title: "硬件工程师" });
  await jobs.updatePosition(kept, { companyName: "示例集团", title: "硬件测试工程师" });
  assert.equal(await companyOf(kept), "示例集团");
});
