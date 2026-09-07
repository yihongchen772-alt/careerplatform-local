const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { inspectDatabase, backupDesktopData } = require("../electron/data-backup.cjs");
const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
if (!fs.existsSync(envFile)) {
  fs.writeFileSync(envFile, `DATABASE_URL="file:./local.db"\nNEXTAUTH_SECRET="${crypto.randomBytes(32).toString("hex")}"\nNEXTAUTH_URL="http://localhost:3000"\n`);
}
async function setup() {
  const configFile = path.join(root, ".local-desktop.json");
  if (fs.existsSync(configFile)) {
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    const current = inspectDatabase(path.join(config.dataDir, "local.db"));
    const expected = fs.readdirSync(path.join(root, "prisma", "migrations"), { withFileTypes: true }).filter(entry => entry.isDirectory()).length;
    if (current.migrations < expected) {
      const result = await backupDesktopData(config.dataDir, path.join(root, ".local-data", "backups"));
      console.log("Created database backup before migration: " + result.backupPath);
    }
  } else {
    const env = fs.readFileSync(envFile, "utf8");
    if (/DATABASE_URL="file:\.\/local\.db"/.test(env) && !fs.existsSync(path.join(root, "prisma", "local.db"))) {
      const database = new DatabaseSync(path.join(root, "prisma", "local.db"));
      database.close();
    }
  }
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
setup().catch(error => { console.error(error.message); process.exitCode = 1; });
