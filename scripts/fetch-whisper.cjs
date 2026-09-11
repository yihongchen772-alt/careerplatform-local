const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Local speech-to-text for 面试录音 (see electron/whisper.js). The whisper.cpp
// project publishes prebuilt Windows binaries on every tagged build but no
// macOS ones, so the two platforms are sourced differently, pinned to the
// same upstream build tag so they behave identically:
//   - win32-x64: the official whisper-bin-x64.zip (CPU, generic x64)
//   - darwin-arm64: compiled here from the same tag, static, Metal shader
//     embedded so the single binary is self-contained
// Both land in build/whisper/<platform>-<arch>/ (gitignored) and get shipped
// as extraResources by electron-builder.cjs. Model files are NOT bundled —
// they're 200-500 MB and downloaded on demand into userData.
const WHISPER_TAG = "b5130";
const projectRoot = path.resolve(__dirname, "..");
const outRoot = path.join(projectRoot, "build", "whisper");

function log(msg) {
  console.log(`[fetch-whisper] ${msg}`);
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function fetchWindows() {
  const dir = path.join(outRoot, "win32-x64");
  const exe = path.join(dir, "whisper-cli.exe");
  if (fs.existsSync(exe)) {
    log("win32-x64 already present, skipping.");
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, "whisper-bin-x64.zip");
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/whisper-bin-x64.zip`;
  log(`downloading ${url}`);
  await download(url, zip);
  // The archive nests everything under Release/; flatten so the exe and its
  // DLLs sit next to each other where electron/whisper.js expects them.
  execFileSync("unzip", ["-o", "-q", zip, "-d", dir]);
  fs.rmSync(zip);
  const release = path.join(dir, "Release");
  if (fs.existsSync(release)) {
    for (const entry of fs.readdirSync(release)) fs.renameSync(path.join(release, entry), path.join(dir, entry));
    fs.rmdirSync(release);
  }
  if (!fs.existsSync(exe)) throw new Error("whisper-cli.exe missing after unzip");
  // Only the CLI and its runtime DLLs are needed; drop the other example
  // binaries the zip carries (server, bench, stream …) to keep the installer lean.
  for (const entry of fs.readdirSync(dir)) {
    if (/\.exe$/i.test(entry) && entry !== "whisper-cli.exe") fs.rmSync(path.join(dir, entry));
  }
  log(`win32-x64 done: ${fs.readdirSync(dir).join(", ")}`);
}

function buildMac() {
  const dir = path.join(outRoot, "darwin-arm64");
  const bin = path.join(dir, "whisper-cli");
  if (fs.existsSync(bin)) {
    log("darwin-arm64 already present, skipping.");
    return;
  }
  const src = path.join(projectRoot, ".local-run", "whisper.cpp");
  if (!fs.existsSync(path.join(src, "CMakeLists.txt"))) {
    log(`cloning whisper.cpp @ ${WHISPER_TAG}`);
    fs.mkdirSync(path.dirname(src), { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", "--branch", WHISPER_TAG, "https://github.com/ggml-org/whisper.cpp.git", src], { stdio: "inherit" });
  }
  log("building (cmake, static, Metal embedded)…");
  const buildDir = path.join(src, "build-careerplatform");
  execFileSync("cmake", [
    "-S", src, "-B", buildDir,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DGGML_METAL=ON",
    "-DGGML_METAL_EMBED_LIBRARY=ON",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
  ], { stdio: "inherit" });
  execFileSync("cmake", ["--build", buildDir, "--config", "Release", "--target", "whisper-cli", "-j", "8"], { stdio: "inherit" });
  const built = path.join(buildDir, "bin", "whisper-cli");
  if (!fs.existsSync(built)) throw new Error("whisper-cli not produced by the build");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(built, bin);
  fs.chmodSync(bin, 0o755);
  log(`darwin-arm64 done: ${bin}`);
}

async function main() {
  const targets = process.argv.slice(2);
  const wantWin = targets.length === 0 || targets.includes("win");
  const wantMac = targets.length === 0 || targets.includes("mac");
  if (wantWin) await fetchWindows();
  if (wantMac) {
    if (process.platform !== "darwin") {
      log("skipping darwin-arm64 build: not on macOS");
    } else {
      buildMac();
    }
  }
}

main().catch((err) => {
  console.error(`[fetch-whisper] ${err.message}`);
  process.exit(1);
});
