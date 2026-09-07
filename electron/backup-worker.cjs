// Run as a Node child process: node:sqlite is not exposed in Electron's renderer.
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { backupDesktopData } = require("./data-backup.cjs");
const dataDir = process.argv[2];
if (!dataDir || !path.isAbsolute(dataDir)) throw new Error("An absolute data directory is required.");
if (process.argv[3] === "--initialize") {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "local.db"));
  db.close();
} else backupDesktopData(dataDir, dataDir + "-backups")
  .then(result => console.log(JSON.stringify({ backupPath: result.backupPath })))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
