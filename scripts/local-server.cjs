const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
require("@next/env").loadEnvConfig(root, false);
const standalone = path.join(root, ".next", "standalone");
const server = path.join(standalone, "server.js");
if (!fs.existsSync(server)) throw new Error("Run npm run desktop:prepare before starting the local server.");
fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
const publicFiles = execFileSync("git", ["ls-files", "-z", "--", "public"], { cwd: root, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
for (const file of publicFiles) {
  const target = path.join(standalone, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, file), target);
}
// Prisma's schema is relocated in standalone; resolve local relative URLs now.
if (process.env.DATABASE_URL?.startsWith("file:.")) process.env.DATABASE_URL = "file:" + path.resolve(root, "prisma", process.env.DATABASE_URL.slice(5)).replaceAll("\\", "/");
process.env.LOCAL_UPLOADS_DIR ||= path.join(root, "uploads");
process.env.HOSTNAME = "127.0.0.1";
process.env.PORT = "3000";
process.env.NODE_ENV = "production";
require(server);
