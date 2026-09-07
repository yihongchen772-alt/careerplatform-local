const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { backupDesktopData, inspectDatabase, validateEncryption } = require("../electron/data-backup.cjs");

function fixture(t) {
  const base = path.resolve(__dirname, "../.local-run/data-tests");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "case-"));
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, "uploads"), { recursive: true });
  const db = new DatabaseSync(path.join(source, "local.db"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE Position(id TEXT); CREATE TABLE AiKey(apiKeyEncrypted TEXT); INSERT INTO Position VALUES ('keep-my-data');");
  fs.writeFileSync(path.join(source, "uploads", "resume.pdf"), "local attachment");
  fs.writeFileSync(path.join(source, ".secret"), "test-only-encryption-secret");
  t.after(() => {
    db.close();
    if (path.dirname(fs.realpathSync(root)) !== fs.realpathSync(base)) throw new Error("Invalid cleanup target");
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, source, db };
}

test("online backup includes committed WAL data, attachments and the original secret", async (t) => {
  const { root, source, db } = fixture(t);
  db.exec("INSERT INTO Position VALUES ('committed-in-wal')");
  const result = await backupDesktopData(source, path.join(root, "backups"));
  assert.equal(result.database.counts.Position, 2);
  assert.equal(result.database.integrity, "ok");
  assert.equal(result.attachmentCount, 1);
  assert.equal(fs.readFileSync(path.join(result.backupPath, ".secret"), "utf8"), "test-only-encryption-secret");
  assert.equal(fs.readFileSync(path.join(result.backupPath, "uploads", "resume.pdf"), "utf8"), "local attachment");
  assert.equal(inspectDatabase(path.join(source, "local.db")).counts.Position, 2);
});

test("multiple backups keep earlier snapshots intact", async (t) => {
  const { root, source, db } = fixture(t);
  const first = await backupDesktopData(source, path.join(root, "backups"));
  db.exec("INSERT INTO Position VALUES ('later-change')");
  const second = await backupDesktopData(source, path.join(root, "backups"));
  assert.notEqual(first.backupPath, second.backupPath);
  assert.equal(inspectDatabase(path.join(first.backupPath, "local.db")).counts.Position, 1);
  assert.equal(inspectDatabase(path.join(second.backupPath, "local.db")).counts.Position, 2);
});

test("encryption is verified without returning any plaintext key", (t) => {
  const { source, db } = fixture(t);
  const key = crypto.scryptSync("test-only-encryption-secret", "careerplatform-ai-key", 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update("test-key-not-a-real-credential"), cipher.final()]);
  const stored = [iv, cipher.getAuthTag(), data].map(v => v.toString("hex")).join(":");
  db.prepare("INSERT INTO AiKey VALUES (?)").run(stored);
  assert.equal(validateEncryption(source), 1);
  fs.writeFileSync(path.join(source, ".secret"), "wrong-secret");
  assert.throws(() => validateEncryption(source));
});

test("backup refuses a destination nested within source data", async (t) => {
  const { source } = fixture(t);
  await assert.rejects(backupDesktopData(source, path.join(source, "backups")), /outside/);
});
