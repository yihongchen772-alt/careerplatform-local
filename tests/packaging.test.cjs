const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isPrivatePath, verifyDirectory, copySafe } = require("../scripts/packaging-prepare.cjs");

function fixture(t) {
  const parent = path.resolve(__dirname, "../.local-run/packaging-tests");
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, "case-"));
  t.after(() => {
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(parent)) throw new Error("Invalid cleanup target");
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test("packaging rejects databases, credentials and backup variants on either path separator", () => {
  for (const file of [".env", ".env-production", "x/.env.local", "x\\.secret-old", "local.db", "local.db-wal", "local.sqlite3-journal", "data.backup.zip", "export.bak", "careerplatform-backups/manifest.json", "public/data-backup-2026.zip", "uploads/resume.pdf", "app-settings.json", ".local-desktop.json"]) {
    assert.equal(isPrivatePath(file), true, file);
  }
  for (const file of ["electron/backup-worker.cjs", "electron/data-backup.cjs", "prisma/migrations/initial/migration.sql", "node_modules/.prisma/client/index.js", "node_modules/@prisma/engines/schema-engine-windows.exe"]) {
    assert.equal(isPrivatePath(file), false, file);
  }
  for (const file of [".agents/skills/neon/SKILL.md", ".claude/skills/neon", ".codex/project.json"]) {
    assert.equal(isPrivatePath(file), false, file);
  }
});

test("copying runtime inputs excludes private files and source maps", t => {
  const root = fixture(t);
  const source = path.join(root, "input");
  const dest = path.join(root, "output");
  fs.mkdirSync(path.join(source, "uploads"), { recursive: true });
  for (const name of ["server.js", ".env.local", "data.db", "server.js.map", "uploads/resume.pdf"]) {
    fs.writeFileSync(path.join(source, name), "test fixture");
  }
  copySafe(source, dest);
  assert.deepEqual(fs.readdirSync(dest), ["server.js"]);
  assert.throws(() => copySafe(path.join(source, ".env.local"), path.join(root, "renamed.txt")), /private/);
});

test("final verification detects a private file introduced after staging", t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "local.db-wal"), "test fixture");
  assert.throws(() => verifyDirectory(root, []), /Private file/);
});

test("a symlink cannot rename a private directory into a public packaging input", t => {
  const root = fixture(t);
  const source = path.join(root, "input");
  const privateDir = path.join(root, "uploads");
  fs.mkdirSync(source);
  fs.mkdirSync(privateDir);
  fs.writeFileSync(path.join(privateDir, "resume.txt"), "private test fixture");
  fs.symlinkSync(privateDir, path.join(source, "images"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => copySafe(source, path.join(root, "output")), /private or external/);
  assert.throws(() => verifyDirectory(source, []), /symbolic link/);
});

test("final verification finds a secret inside any resource type without logging it", t => {
  const root = fixture(t);
  const secret = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(path.join(root, "image.svg"), `<svg data-test="${secret}"/>`);
  assert.throws(() => verifyDirectory(root, [Buffer.from(secret)]), error => {
    assert.match(error.message, /Sensitive environment value/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});
