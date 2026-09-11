const http = require("http");
const crypto = require("crypto");

// Job radar's static-HTML fetch runs in the Next.js server child process,
// which has no Electron APIs of its own (it's a plain Node process this
// app spawns, not a renderer). This bridge is how that process asks the
// *actual* Electron main process — which does have BrowserWindow — to
// render a JS-heavy page and hand back the resulting visible text. Chose a
// hidden BrowserWindow over adding Playwright/Puppeteer as a dependency:
// Electron already bundles a full Chromium, so this costs zero extra
// install size, and the same rendering approach is already used for the
// 网申浏览器 feature.

const RENDER_TIMEOUT_MS = 20000;
// SPA content often keeps populating after the load event fires — a fixed
// settle delay is a blunt instrument, but there's no generic way to know
// "the job list has finished appearing" across arbitrary career sites
// without site-specific selectors, which this deliberately avoids.
const POST_LOAD_SETTLE_MS = 3000;
// Bounds how many hidden windows can be open at once — background radar
// checks for many companies could otherwise all fire around the same tick.
const MAX_CONCURRENT_RENDERS = 2;

let activeCount = 0;
const queue = [];

function runNext() {
  if (activeCount >= MAX_CONCURRENT_RENDERS || queue.length === 0) return;
  activeCount++;
  const job = queue.shift();
  renderOne(job.url, job.partition)
    .then(job.resolve, job.reject)
    .finally(() => {
      activeCount--;
      runNext();
    });
}

function enqueueRender(url, partition) {
  return new Promise((resolve, reject) => {
    queue.push({ url, partition, resolve, reject });
    runNext();
  });
}

// The only session a caller may borrow besides the default one: the 网申
// 浏览器's, so 网申进度同步 can read a candidate portal the user is already
// logged into. Whitelisted by name rather than accepting arbitrary
// partitions — this bridge is reachable by anything holding the token.
const APPLICATION_BROWSER_PARTITION = "persist:job-application-browser";

async function renderOne(url, partition) {
  const { BrowserWindow, session } = require("electron");
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: true,
      images: false,
      ...(partition === APPLICATION_BROWSER_PARTITION
        ? { session: session.fromPartition(APPLICATION_BROWSER_PARTITION) }
        : {}),
    },
  });
  try {
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("页面加载超时")), RENDER_TIMEOUT_MS);
      win.webContents.once("did-finish-load", () => {
        clearTimeout(timer);
        resolve();
      });
      win.webContents.once("did-fail-load", (_event, code, description) => {
        clearTimeout(timer);
        reject(new Error(`页面加载失败：${description || code}`));
      });
    });
    await win.loadURL(url);
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, POST_LOAD_SETTLE_MS));
    const text = await win.webContents.executeJavaScript(
      "document.body ? document.body.innerText : ''"
    );
    return typeof text === "string" ? text : "";
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

/**
 * Starts the loopback-only bridge server and returns its address plus a
 * per-launch bearer token. Never bind beyond 127.0.0.1 — this hands out a
 * "render any URL in a hidden window and read its content" capability,
 * gated only by the token, so it must not be reachable from anywhere but
 * this machine's own Next.js child process.
 */
function startRenderBridge() {
  const token = crypto.randomBytes(24).toString("hex");

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/render") {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (tooLarge) return;
      let url;
      let partition;
      try {
        ({ url, partition } = JSON.parse(body));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "无效请求体" }));
        return;
      }
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "无效 URL" }));
        return;
      }
      if (partition != null && partition !== APPLICATION_BROWSER_PARTITION) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "不支持的会话分区" }));
        return;
      }
      try {
        const text = await enqueueRender(url, partition);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ text }));
      } catch (err) {
        res
          .writeHead(502, { "Content-Type": "application/json" })
          .end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        token,
        close: () => server.close(),
      });
    });
  });
}

module.exports = { startRenderBridge };
