const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync, backup } = require("node:sqlite");

const TABLES = ["User", "Company", "Position", "Application", "JobLead", "ResumeVersion", "AiKey", "PersonalTask", "Contact", "StageHistory", "MailAccount", "InterviewSession"];

function inspectDatabase(file) {
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
  try {
    const present = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    return {
      integrity: Object.values(db.prepare("PRAGMA quick_check").get())[0],
      counts: Object.fromEntries(TABLES.filter(t => present.has(t)).map(t => [t, db.prepare(`SELECT COUNT(*) AS count FROM "${t}"`).get().count])),
      migrations: present.has("_prisma_migrations") ? db.prepare("SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL").get().count : 0,
    };
  } finally { db.close(); }
}

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error("Backup refuses symbolic links: " + entry.name);
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

async function backupDesktopData(dataDir, backupRoot) {
  const source = path.resolve(dataDir);
  const sourceDb = path.join(source, "local.db");
  if (!fs.existsSync(sourceDb)) throw new Error("Desktop database was not found.");
  const info = inspectDatabase(sourceDb);
  if (info.integrity !== "ok") throw new Error("Database integrity check failed; no changes made.");
  const target = path.join(path.resolve(backupRoot), new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(3).toString("hex"));
  const relative = path.relative(source, target);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Backup must be outside the source directory.");
  fs.mkdirSync(target, { recursive: true });
  const db = new DatabaseSync(sourceDb, { readOnly: true, timeout: 5000 });
  try { await backup(db, path.join(target, "local.db")); } finally { db.close(); }
  const assets = [".secret", "app-settings.json"].map(n => path.join(source, n)).filter(f => fs.existsSync(f));
  assets.push(...filesUnder(path.join(source, "uploads")));
  const hashes = {};
  for (const sourceFile of assets) {
    const name = path.relative(source, sourceFile);
    const targetFile = path.join(target, name);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
    const originalHash = crypto.createHash("sha256").update(fs.readFileSync(sourceFile)).digest("hex");
    const copiedHash = crypto.createHash("sha256").update(fs.readFileSync(targetFile)).digest("hex");
    if (originalHash !== copiedHash) throw new Error("An attachment changed during backup; please close the app and retry.");
    hashes[name] = copiedHash;
  }
  const copied = inspectDatabase(path.join(target, "local.db"));
  if (copied.integrity !== "ok") throw new Error("Backup validation failed.");
  const manifest = { createdAt: new Date().toISOString(), source, database: copied, files: hashes };
  fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { backupPath: target, database: copied, attachmentCount: assets.filter(f => f.startsWith(path.join(source, "uploads") + path.sep)).length };
}

function validateEncryption(dataDir) {
  const file = path.join(dataDir, ".secret");
  if (!fs.existsSync(file)) throw new Error("The existing desktop encryption secret is missing. Do not generate a replacement.");
  const secret = fs.readFileSync(file, "utf8").trim();
  if (!secret) throw new Error("The desktop encryption secret is empty.");
  const db = new DatabaseSync(path.join(dataDir, "local.db"), { readOnly: true });
  try {
    const rows = db.prepare("SELECT apiKeyEncrypted FROM AiKey").all();
    const key = crypto.scryptSync(secret, "careerplatform-ai-key", 32);
    for (const row of rows) {
      const [iv, tag, data] = row.apiKeyEncrypted.split(":");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
      decipher.setAuthTag(Buffer.from(tag, "hex"));
      // Verify decryption without returning, logging, or transmitting credentials.
      decipher.update(Buffer.from(data, "hex"));
      decipher.final();
    }
    return rows.length;
  } finally { db.close(); }
}


module.exports = { inspectDatabase, backupDesktopData, validateEncryption, filesUnder };
