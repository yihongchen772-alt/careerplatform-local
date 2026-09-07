const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
const scratchRoot = path.join(projectRoot, ".local-run", "packaging-build");
fs.mkdirSync(scratchRoot, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchRoot, "empty-"));
const buildStamp = path.join(projectRoot, ".next", "desktop-build.json");
fs.rmSync(buildStamp, { force: true });

// Never prerender an installer against the developer's real database, uploads,
// or encryption secret. These overrides affect only the child processes.
const buildEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: `file:${path.join(scratch, "empty.db").replaceAll("\\", "/")}`,
  LOCAL_UPLOADS_DIR: path.join(scratch, "uploads"),
  NEXTAUTH_SECRET: crypto.randomBytes(32).toString("hex"),
  NEXTAUTH_URL: "http://127.0.0.1:3210",
  NEXT_TELEMETRY_DISABLED: "1",
};
fs.mkdirSync(buildEnv.LOCAL_UPLOADS_DIR);

function run(entry, args) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: projectRoot,
    env: buildEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Desktop build step failed (${result.status}).`);
}

try {
  // Prisma's Windows engine can fail to create the initial SQLite file in a
  // path containing non-ASCII characters. Create it before invoking migrate.
  const emptyDb = new DatabaseSync(path.join(scratch, "empty.db"));
  emptyDb.exec("PRAGMA user_version = 0;");
  emptyDb.close();
  run(require.resolve("prisma/build/index.js"), ["migrate", "deploy", "--schema", "prisma/schema.prisma"]);
  run(require.resolve("next/dist/bin/next"), ["build"]);
  const buildId = fs.readFileSync(path.join(projectRoot, ".next", "BUILD_ID"), "utf8").trim();
  fs.writeFileSync(buildStamp, JSON.stringify({ buildId, isolatedData: true, platform: process.platform, arch: process.arch }));
  console.log("Desktop build completed using an empty temporary database.");
} finally {
  // This exact, newly-created directory is the only recursive deletion target.
  const resolved = fs.realpathSync(scratch);
  if (path.dirname(resolved) !== fs.realpathSync(scratchRoot)) {
    throw new Error("Refusing to remove a packaging directory outside its scratch root.");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
