const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

/** A local build may add migrations without changing package.json's version. */
function hasPendingMigrations(dbFile, migrationsDir) {
  const available = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d/.test(entry.name))
    .map((entry) => entry.name);
  if (!available.length) return false;
  const db = new DatabaseSync(dbFile, { readOnly: true, timeout: 5000 });
  try {
    const applied = new Set(db.prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL").all().map((row) => row.migration_name));
    return available.some((name) => !applied.has(name));
  } catch {
    // Missing migration metadata needs a backup before Prisma reports the error.
    return true;
  } finally { db.close(); }
}
module.exports = { hasPendingMigrations };
