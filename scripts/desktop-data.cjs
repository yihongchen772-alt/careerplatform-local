const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const { inspectDatabase, backupDesktopData, validateEncryption, filesUnder } = require("../electron/data-backup.cjs");

async function main() {
  const root = path.resolve(__dirname, "..");
  const dataDir = path.resolve(process.argv[3] || path.join(process.env.APPDATA, "careerplatform"));
  const command = process.argv[2] || "inspect";
  if (command === "inspect") {
    console.log(JSON.stringify({ dataDir, ...inspectDatabase(path.join(dataDir, "local.db")), encryptionKeysVerified: validateEncryption(dataDir), attachmentCount: filesUnder(path.join(dataDir, "uploads")).length }, null, 2));
  } else if (command === "attach") {
    const keysVerified = validateEncryption(dataDir);
    const result = await backupDesktopData(dataDir, path.join(root, ".local-data", "backups"));
    const envFile = path.join(root, ".env");
    if (fs.existsSync(envFile)) fs.copyFileSync(envFile, path.join(result.backupPath, "previous-web.env"));
    const previousDb = path.join(root, "prisma", "local.db");
    if (fs.existsSync(previousDb)) {
      const oldDb = new DatabaseSync(previousDb, { readOnly: true });
      try { await backup(oldDb, path.join(result.backupPath, "previous-web.db")); } finally { oldDb.close(); }
    }
    const secret = fs.readFileSync(path.join(dataDir, ".secret"), "utf8").trim();
    const normalized = dataDir.replaceAll("\\", "/");
    fs.writeFileSync(envFile, `DATABASE_URL=${JSON.stringify("file:" + normalized + "/local.db")}\nLOCAL_UPLOADS_DIR=${JSON.stringify(normalized + "/uploads")}\nNEXTAUTH_SECRET=${JSON.stringify(secret)}\nNEXTAUTH_URL="http://localhost:3000"\n`);
    fs.writeFileSync(path.join(root, ".local-desktop.json"), JSON.stringify({ dataDir, backupPath: result.backupPath }, null, 2));
    console.log(JSON.stringify({ ...result, keysVerified, attached: true }, null, 2));
  } else throw new Error("Use inspect or attach.");
}

module.exports = { inspectDatabase, backupDesktopData, validateEncryption };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
