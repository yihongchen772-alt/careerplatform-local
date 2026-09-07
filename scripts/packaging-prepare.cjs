const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const stageRoot = path.join(projectRoot, ".local-run", "packaging");
const runtimeRoot = path.join(stageRoot, "runtime");
const shellRoot = path.join(stageRoot, "shell");

// A positive allowlist selects roots below; this second layer also applies to
// traced files, nested dependencies and the finished Electron resources.
function isPrivatePath(relative) {
  return relative.replaceAll("\\", "/").split("/").some((part) =>
    /^\.env(?:[._-]|$)/i.test(part) ||
    /^\.secret(?:[._-]|$)/i.test(part) ||
    /\.(?:db|sqlite|sqlite3)(?:$|[-.])/i.test(part) ||
    /\.(?:bak|backup)(?:$|[.-])/i.test(part) ||
    /(?:^|[._-])backups?(?:[._-].*)?\.(?:zip|tar|gz|7z)$/i.test(part) ||
    /^(?:uploads|backups?|userData|\.git|\.local-run|\.local-data)$/i.test(part) ||
    /^.+[-_]backups?$/i.test(part) ||
    /^(?:app-settings|\.local-desktop)\.json$/i.test(part)
  );
}

function isBuildOnlyPath(relative) {
  const parts = relative.replaceAll("\\", "/").split("/");
  return parts.some((part) => /^(?:\.bin|\.cache|__tests__|__mocks__|tests?|coverage)$/i.test(part)) ||
    /(?:^|\/)next\/dist\/docs(?:\/|$)/.test(parts.join("/")) ||
    /\.(?:map|tsbuildinfo)$/i.test(relative);
}

function copySafe(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Required packaging input missing: ${path.relative(projectRoot, source)}`);
  if (isPrivatePath(path.basename(source))) throw new Error("Refusing to copy a private packaging input.");
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (filename) => {
      const relative = path.relative(source, filename);
      if (isPrivatePath(relative) || isBuildOnlyPath(relative)) return false;
      if (fs.lstatSync(filename).isSymbolicLink()) {
        const target = path.relative(projectRoot, fs.realpathSync(filename));
        if (target === ".." || target.startsWith(`..${path.sep}`) || path.isAbsolute(target) || isPrivatePath(target)) {
          throw new Error(`Packaging input links to a private or external location: ${relative}`);
        }
      }
      return true;
    },
  });
}

function resetStage() {
  const parent = path.join(projectRoot, ".local-run");
  fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(stageRoot)) {
    const resolved = fs.realpathSync(stageRoot);
    if (path.dirname(resolved) !== fs.realpathSync(parent) || fs.lstatSync(stageRoot).isSymbolicLink()) {
      throw new Error("Refusing to replace a packaging stage outside .local-run.");
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(shellRoot, { recursive: true });
}

// Copy the complete production dependency closure for executables that Next
// cannot trace (Prisma migrations and Electron's updater). Preserve nested
// node_modules locations so multiple versions resolve exactly as installed.
function copyProductionPackage(name, destinationRoot, from = projectRoot, seen = new Set()) {
  const resolver = createRequire(path.join(from, "package.json"));
  const candidates = resolver.resolve.paths(name) || [];
  const packageRoot = candidates.map((base) => path.join(base, name))
    .find((candidate) => fs.existsSync(path.join(candidate, "package.json")));
  if (!packageRoot) throw new Error(`Required runtime dependency is not installed: ${name}`);
  const relative = path.relative(projectRoot, packageRoot);
  if (relative.startsWith("..") || !relative.startsWith(`node_modules${path.sep}`)) {
    throw new Error(`Runtime dependency resolves outside this project's node_modules: ${name}`);
  }
  if (seen.has(packageRoot)) return;
  seen.add(packageRoot);
  copySafe(packageRoot, path.join(destinationRoot, relative));
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  for (const dependency of Object.keys(metadata.dependencies || {})) {
    // npm permits optionalDependencies to override an entry in dependencies.
    // A package for another OS may legitimately be absent from node_modules.
    if (Object.hasOwn(metadata.optionalDependencies || {}, dependency)) continue;
    copyProductionPackage(dependency, destinationRoot, packageRoot, seen);
  }
  for (const dependency of Object.keys(metadata.peerDependencies || {})) {
    if (!metadata.peerDependenciesMeta?.[dependency]?.optional) {
      copyProductionPackage(dependency, destinationRoot, packageRoot, seen);
    }
  }
  for (const dependency of Object.keys(metadata.optionalDependencies || {})) {
    const optionalResolver = createRequire(path.join(packageRoot, "package.json"));
    if ((optionalResolver.resolve.paths(dependency) || []).some((base) => fs.existsSync(path.join(base, dependency, "package.json")))) {
      copyProductionPackage(dependency, destinationRoot, packageRoot, seen);
    }
  }
}

function sensitiveValues() {
  const values = new Set();
  const add = (name, value) => {
    if (!/(?:SECRET|PASSWORD|TOKEN|API_?KEY|PRIVATE_KEY)/i.test(name)) return;
    value = String(value || "").trim().replace(/^(["'])(.*)\1$/, "$2");
    if (value.length >= 12 && !/^(?:change[-_ ]?me|your[-_ ]|example|placeholder)/i.test(value)) values.add(value);
  };
  for (const [name, value] of Object.entries(process.env)) add(name, value);
  for (const entry of fs.readdirSync(projectRoot)) {
    if (!/^\.env(?:\.|$)/.test(entry) || entry === ".env.example") continue;
    const filename = path.join(projectRoot, entry);
    if (!fs.statSync(filename).isFile()) continue;
    for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=\s*(.*)$/);
      if (match) add(match[1], match[2]);
    }
  }
  return [...values].map((value) => Buffer.from(value));
}

function verifyDirectory(directory, secrets = sensitiveValues()) {
  let bytes = 0;
  let files = 0;
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      const relative = path.relative(directory, filename);
      if (isPrivatePath(relative)) throw new Error(`Private file found in package: ${relative}`);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symbolic link in package: ${relative}`);
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile()) {
        const size = fs.statSync(filename).size;
        bytes += size;
        files += 1;
        // Credentials can also be embedded in CSS, SVGs or binary metadata.
        if (secrets.length) {
          const contents = fs.readFileSync(filename);
          if (secrets.some((secret) => contents.includes(secret))) {
            // Never include the matching secret or its surrounding content.
            throw new Error(`Sensitive environment value detected in package: ${relative}`);
          }
        }
      }
    }
  }
  visit(directory);
  return { files, bytes };
}

function assertBuildStamp() {
  const nextRoot = path.join(projectRoot, ".next");
  const stampFile = path.join(nextRoot, "desktop-build.json");
  if (!fs.existsSync(stampFile)) throw new Error("Run the isolated desktop build first: node scripts/packaging-build.cjs");
  const stamp = JSON.parse(fs.readFileSync(stampFile, "utf8"));
  const buildId = fs.readFileSync(path.join(nextRoot, "BUILD_ID"), "utf8").trim();
  if (!stamp.isolatedData || stamp.buildId !== buildId || stamp.platform !== process.platform || stamp.arch !== process.arch) {
    throw new Error("Desktop build is stale or was built for another host. Run packaging-build.cjs again.");
  }
}

function prepareRuntime() {
  assertBuildStamp();
  resetStage();
  const standalone = path.join(projectRoot, ".next", "standalone");
  // Do not copy standalone wholesale: dynamic tracing can accidentally collect
  // the source tree, .env backups, or files from an existing local installation.
  for (const entry of ["server.js", "node_modules"]) copySafe(path.join(standalone, entry), path.join(runtimeRoot, entry));
  const standaloneNext = path.join(standalone, ".next");
  fs.mkdirSync(path.join(runtimeRoot, ".next"), { recursive: true });
  for (const entry of fs.readdirSync(standaloneNext, { withFileTypes: true })) {
    // Turbopack also stores hashed external-package aliases in .next/node_modules
    // (for example @prisma/client-<hash>). The server chunks require those names.
    if (entry.name === "server" || entry.name === "node_modules" || (entry.isFile() && (entry.name === "BUILD_ID" || entry.name.endsWith(".json")))) {
      copySafe(path.join(standaloneNext, entry.name), path.join(runtimeRoot, ".next", entry.name));
    }
  }
  copySafe(path.join(projectRoot, ".next", "static"), path.join(runtimeRoot, ".next", "static"));
  // Public assets ship only if they are part of the repository. A resume
  // temporarily dropped into public/ must never become part of an installer.
  const publicFiles = execFileSync("git", ["ls-files", "-z", "--", "public"], { cwd: projectRoot, windowsHide: true, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const relative of publicFiles) {
    if (!isPrivatePath(relative) && fs.existsSync(path.join(projectRoot, relative))) {
      copySafe(path.join(projectRoot, relative), path.join(runtimeRoot, relative));
    }
  }
  copySafe(path.join(projectRoot, "prisma", "schema.prisma"), path.join(runtimeRoot, "prisma", "schema.prisma"));
  copySafe(path.join(projectRoot, "prisma", "migrations"), path.join(runtimeRoot, "prisma", "migrations"));
  copySafe(path.join(projectRoot, "node_modules", ".prisma"), path.join(runtimeRoot, "node_modules", ".prisma"));
  copyProductionPackage("prisma", runtimeRoot);
  const metadata = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  fs.writeFileSync(path.join(runtimeRoot, "package.json"), JSON.stringify({ name: metadata.name, version: metadata.version, private: true }));

  const updaterVersion = metadata.dependencies?.["electron-updater"];
  if (!updaterVersion) throw new Error("electron-updater must be installed as a production dependency.");
  fs.mkdirSync(path.join(shellRoot, "electron"));
  for (const entry of fs.readdirSync(path.join(projectRoot, "electron"), { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:js|cjs|json)$/.test(entry.name) && !isPrivatePath(entry.name)) {
      copySafe(path.join(projectRoot, "electron", entry.name), path.join(shellRoot, "electron", entry.name));
    }
  }
  fs.writeFileSync(path.join(shellRoot, "package.json"), JSON.stringify({
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    author: metadata.author,
    main: "electron/main.js",
    dependencies: { "electron-updater": updaterVersion },
  }, null, 2));
  copyProductionPackage("electron-updater", shellRoot);
  const summary = { runtime: verifyDirectory(runtimeRoot), electron: verifyDirectory(shellRoot) };
  fs.writeFileSync(path.join(stageRoot, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`Prepared runtime: ${(summary.runtime.bytes / 1024 / 1024).toFixed(1)} MiB; Electron application: ${(summary.electron.bytes / 1024 / 1024).toFixed(1)} MiB. Private-file and secret checks passed.`);
  return summary;
}

async function afterPack(context) {
  const resources = context.electronPlatformName === "darwin"
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
    : path.join(context.appOutDir, "resources");
  // electron-builder treats any directory named node_modules as an application
  // dependency tree, even inside extraResources, and silently filters it. Copy
  // the already allowlisted and verified runtime after the Electron shell is
  // packed so Next's complete standalone dependency closure is preserved.
  const packagedRuntime = path.join(resources, "app-runtime");
  if (fs.existsSync(packagedRuntime)) fs.rmSync(packagedRuntime, { recursive: true, force: true });
  fs.cpSync(runtimeRoot, packagedRuntime, { recursive: true, dereference: true });
  verifyDirectory(resources);
  const archive = path.join(resources, "app.asar");
  const asar = require("@electron/asar");
  for (const entry of asar.listPackage(archive)) {
    if (isPrivatePath(entry)) throw new Error(`Private path in Electron archive: ${entry}`);
  }
  for (const required of ["server.js", "prisma/schema.prisma", "node_modules/prisma/build/index.js", ".next/BUILD_ID"]) {
    if (!fs.existsSync(path.join(resources, "app-runtime", required))) throw new Error(`Packaged runtime entry missing: ${required}`);
  }
  for (const required of ["backup-worker.cjs", "data-backup.cjs"]) {
    if (!fs.existsSync(path.join(resources, "app.asar.unpacked", "electron", required))) {
      throw new Error(`Unpacked Node worker entry missing: ${required}`);
    }
  }
  console.log("Finished Electron resources passed private-file and secret checks.");
}

module.exports = { prepareRuntime, afterPack, verifyDirectory, isPrivatePath, isBuildOnlyPath, copySafe };
if (require.main === module) {
  try { prepareRuntime(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
