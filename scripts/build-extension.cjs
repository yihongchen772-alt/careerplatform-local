// Assembles the Chrome/Edge extension: extension/ as-is, plus the desktop
// app's own autofill engine (electron/autofill-core.js) wrapped for the
// service worker, and the app version stamped into the manifest. The packaged
// app ships the result (Resources/chrome-extension) and copies it next to its
// data for "加载已解压的扩展程序".
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function buildExtension(outDir = path.join(projectRoot, ".local-run", "chrome-extension")) {
  const source = path.join(projectRoot, "extension");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(source, outDir, { recursive: true });
  const { version } = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const manifestFile = path.join(outDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.version = version;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  const core = fs.readFileSync(path.join(projectRoot, "electron", "autofill-core.js"), "utf8");
  fs.mkdirSync(path.join(outDir, "lib"), { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "lib", "autofill-core.js"),
    `// Generated from electron/autofill-core.js by scripts/build-extension.cjs — do not edit.\n(function () {\nconst module = { exports: {} };\nconst exports = module.exports;\n${core}\nself.JobCompassCore = module.exports;\n})();\n`
  );
  return { outDir, version };
}

module.exports = { buildExtension };
if (require.main === module) {
  const result = buildExtension(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(`Chrome extension ${result.version} → ${result.outDir}`);
}
