const fs = require("node:fs");
const path = require("node:path");

// `generator client { binaryTargets = ["native", "windows"] }` in
// schema.prisma only makes `prisma generate` fetch the *query* engine for
// Windows (the one the generated client uses to run queries) — it has no
// effect on the *schema* engine, which is what `prisma migrate deploy`
// actually runs, and which `@prisma/engines`' own postinstall only ever
// fetches for whichever platform `npm install` ran on (this Mac). Package a
// packaged Windows app never gets a bundled schema-engine, so on first
// launch Prisma CLI falls back to downloading one over the network — and if
// that connection gets reset (firewall, flaky network), the whole app
// crashes at startup with an uncaught ECONNRESET, before the real migration
// even runs. Pre-fetching it here, at build time on this Mac, means the
// Windows package never needs network access just to start.
const projectRoot = path.resolve(__dirname, "..");
const enginesDir = path.join(projectRoot, "node_modules", "@prisma", "engines");
const destination = path.join(enginesDir, "schema-engine-windows.exe");

async function main() {
  if (fs.existsSync(destination)) {
    console.log("[fetch-prisma-windows-engine] already present, skipping download.");
    return;
  }
  const { download, BinaryType } = require("@prisma/fetch-engine");
  const { enginesVersion } = require("@prisma/engines-version");
  console.log(`[fetch-prisma-windows-engine] downloading schema-engine for windows @ ${enginesVersion}…`);
  const paths = await download({
    binaries: { [BinaryType.SchemaEngineBinary]: enginesDir },
    binaryTargets: ["windows"],
    version: enginesVersion,
    showProgress: false,
  });
  const resolved = paths[BinaryType.SchemaEngineBinary]?.windows;
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error("Download reported success but the expected file is missing.");
  }
  console.log(`[fetch-prisma-windows-engine] done: ${path.relative(projectRoot, resolved)}`);
}

main().catch((err) => {
  console.error("[fetch-prisma-windows-engine] failed:", err);
  process.exitCode = 1;
});
