const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

// Local speech-to-text for 面试录音, wrapping the whisper.cpp CLI that
// scripts/fetch-whisper.cjs puts in build/whisper/<platform>-<arch>/ (dev)
// or <resources>/whisper/ (packaged). The binary ships with the app; the
// model does not — 200-500 MB is too much to bolt onto every installer for a
// feature not everyone will use — so it's downloaded on demand into
// userData/whisper-models/ from a mirror that's reachable from China.
//
// Why local at all when Gemini can transcribe audio: an hour-long real
// interview is the most sensitive recording this app will ever hold, and
// "the audio never leaves your machine" is the whole reason someone would
// let the app record it. Gemini stays as the fallback for people who don't
// want to download a model (see src/lib/interview-recording-processor.ts).

const MODELS = {
  // Chinese accuracy: small is usable, medium is noticeably better; both
  // quantized (q5) so the download is ~40% of the fp16 file with no
  // meaningful quality loss for speech.
  small: { file: "ggml-small-q5_1.bin", bytes: 190085487, label: "小模型（约 190 MB，速度快）" },
  medium: { file: "ggml-medium-q5_0.bin", bytes: 539212467, label: "中模型（约 540 MB，更准）" },
};

// hf-mirror first: huggingface.co itself is unreachable from most Chinese
// networks without a proxy, which is exactly where this app's users are.
const MODEL_HOSTS = [
  "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/",
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/",
];

function binaryPath() {
  const exe = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  if (app.isPackaged) return path.join(process.resourcesPath, "whisper", exe);
  return path.join(__dirname, "..", "build", "whisper", `${process.platform}-${process.arch}`, exe);
}

function modelsDir() {
  return path.join(app.getPath("userData"), "whisper-models");
}

function modelPath(name) {
  return path.join(modelsDir(), MODELS[name].file);
}

function installedModels() {
  return Object.keys(MODELS).filter((name) => {
    try {
      return fs.statSync(modelPath(name)).size === MODELS[name].bytes;
    } catch {
      return false;
    }
  });
}

let download = null; // { name, received, total, controller }
let progressListener = null;

function emitProgress() {
  if (progressListener) progressListener(getStatus());
}

/** Set by main.js to push status changes to the renderer. */
function onProgress(listener) {
  progressListener = listener;
}

/**
 * `preferred` is the app setting; falls back to whatever's installed so a
 * user who downloaded medium then switched the setting to small (not yet
 * downloaded) still transcribes locally rather than silently going to Gemini.
 */
function activeModel(preferred) {
  const installed = installedModels();
  if (preferred && installed.includes(preferred)) return preferred;
  return installed.includes("medium") ? "medium" : installed[0] || null;
}

function getStatus(preferred) {
  return {
    binaryAvailable: fs.existsSync(binaryPath()),
    models: Object.fromEntries(
      Object.entries(MODELS).map(([name, m]) => [
        name,
        { file: m.file, bytes: m.bytes, label: m.label, installed: installedModels().includes(name) },
      ])
    ),
    activeModel: activeModel(preferred),
    downloading: download ? { name: download.name, received: download.received, total: download.total } : null,
  };
}

async function downloadModel(name) {
  if (!MODELS[name]) throw new Error("未知的模型");
  if (download) throw new Error("已经有一个模型在下载中");
  fs.mkdirSync(modelsDir(), { recursive: true });
  const dest = modelPath(name);
  const part = `${dest}.part`;
  const controller = new AbortController();
  download = { name, received: 0, total: MODELS[name].bytes, controller };
  emitProgress();
  try {
    let lastError = null;
    for (const host of MODEL_HOSTS) {
      try {
        const res = await fetch(host + MODELS[name].file, { signal: controller.signal, redirect: "follow" });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const total = Number(res.headers.get("content-length")) || MODELS[name].bytes;
        download.total = total;
        download.received = 0;
        const out = fs.createWriteStream(part);
        const reader = res.body.getReader();
        let lastEmit = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          out.write(Buffer.from(value));
          download.received += value.length;
          if (Date.now() - lastEmit > 500) {
            lastEmit = Date.now();
            emitProgress();
          }
        }
        await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
        const size = fs.statSync(part).size;
        if (size !== MODELS[name].bytes) {
          throw new Error(`下载的文件大小不对（${size} ≠ ${MODELS[name].bytes}），可能被截断`);
        }
        fs.renameSync(part, dest);
        return;
      } catch (err) {
        lastError = err;
        fs.rmSync(part, { force: true });
        if (controller.signal.aborted) throw new Error("已取消");
      }
    }
    throw new Error(`模型下载失败：${lastError ? lastError.message : "未知错误"}`);
  } finally {
    download = null;
    emitProgress();
  }
}

function cancelDownload() {
  if (download) download.controller.abort();
}

function deleteModel(name) {
  if (!MODELS[name]) throw new Error("未知的模型");
  fs.rmSync(modelPath(name), { force: true });
  emitProgress();
}

// One transcription at a time: whisper-cli saturates every core it's given,
// and two 5-minute chunks in parallel just take twice as long each.
let queue = Promise.resolve();

function transcribeFile(wavPath, { preferredModel, language = "zh" } = {}) {
  const run = () => runWhisper(wavPath, { preferredModel, language });
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

function runWhisper(wavPath, { preferredModel, language }) {
  return new Promise((resolve, reject) => {
    const bin = binaryPath();
    if (!fs.existsSync(bin)) return reject(new Error("本地转写程序不存在"));
    const model = activeModel(preferredModel);
    if (!model) return reject(new Error("还没有下载转写模型"));

    const outBase = path.join(os.tmpdir(), `cp-whisper-${process.pid}-${Date.now()}`);
    const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
    const args = [
      "-m", modelPath(model),
      "-f", wavPath,
      "-l", language,
      "-t", String(threads),
      "-oj", "-of", outBase,
      "-np",
    ];
    const started = Date.now();
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on("error", (err) => reject(new Error(`无法启动转写程序：${err.message}`)));
    child.on("close", (code) => {
      const jsonFile = `${outBase}.json`;
      try {
        if (code !== 0) throw new Error(`转写程序退出码 ${code}：${stderr.trim().split("\n").slice(-3).join(" | ")}`);
        const parsed = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
        const segments = (parsed.transcription || []).map((s) => ({
          from: Number(s.offsets && s.offsets.from) || 0,
          to: Number(s.offsets && s.offsets.to) || 0,
          text: String(s.text || "").trim(),
        }));
        resolve({ model, segments, elapsedMs: Date.now() - started });
      } catch (err) {
        reject(err);
      } finally {
        fs.rmSync(jsonFile, { force: true });
      }
    });
  });
}

module.exports = {
  MODELS,
  getStatus,
  downloadModel,
  cancelDownload,
  deleteModel,
  transcribeFile,
  onProgress,
  binaryPath,
};
