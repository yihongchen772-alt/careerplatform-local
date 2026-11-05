const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readFeishuBase, feishuBaseRevision } = require("./feishu-base");

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
let sheetQueue = Promise.resolve();
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
// An in-memory session of its own for web searches (the city lookup), so
// they carry neither the 网申浏览器's logins nor the job pages' cookies.
const SEARCH_PARTITION = "cp-search";

async function renderOne(url, partition) {
  const { BrowserWindow, session } = require("electron");
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: true,
      images: false,
      ...(partition === APPLICATION_BROWSER_PARTITION || partition === SEARCH_PARTITION
        ? { session: session.fromPartition(partition) }
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

let printQueue = Promise.resolve();

/**
 * 定制简历 → 简历版本: prints our own resume page (built by
 * src/lib/resume-doc.ts, every value escaped, photo embedded as a data URL)
 * to an A4 PDF. Loaded from a temp file rather than a data: URL so a large
 * photo can't run into the URL length limit; JavaScript stays off.
 */
async function printPdf(html) {
  const { BrowserWindow } = require("electron");
  const file = path.join(os.tmpdir(), `cp-resume-${crypto.randomBytes(8).toString("hex")}.html`);
  fs.writeFileSync(file, html, "utf8");
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true, partition: "cp-document-export" } });
  try {
    await win.loadFile(file);
    return await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rm(file, { force: true }, () => {});
  }
}

const ROUTES = new Set(["/render", "/feishu-base", "/feishu-base-rev", "/print-pdf"]);

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
    if (req.method !== "POST" || !ROUTES.has(req.url)) {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    let body = "";
    let tooLarge = false;
    // A resume page carries its photo inline; everything else is a short JSON.
    const limit = req.url === "/print-pdf" ? 8_000_000 : 10_000;
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limit) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on("end", async () => {
      if (tooLarge) return;
      if (req.url === "/print-pdf") {
        try {
          const { html } = JSON.parse(body);
          if (typeof html !== "string" || !html.startsWith("<!doctype html>")) throw new Error("无效的页面");
          printQueue = printQueue.catch(() => {}).then(() => printPdf(html));
          const pdf = await printQueue;
          res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": pdf.length }).end(pdf);
        } catch (err) {
          res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
        }
        return;
      }
      let url;
      let partition;
      try {
        ({ url, partition } = JSON.parse(body));
        // A subscribed 校招信息表: every row of a shared 飞书多维表格, one sheet at a time.
        if (req.url === "/feishu-base-rev") {
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ rev: await feishuBaseRevision(url) }));
          return;
        }
        if (req.url === "/feishu-base") {
          sheetQueue = sheetQueue.catch(() => {}).then(() => readFeishuBase(url));
          const sheet = await sheetQueue;
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(sheet));
          return;
        }
      } catch (err) {
        const message = req.url.startsWith("/feishu-base") && err && err.message ? err.message : "无效请求体";
        res.writeHead(req.url.startsWith("/feishu-base") ? 502 : 400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }));
        return;
      }
      if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "无效 URL" }));
        return;
      }
      if (partition != null && partition !== APPLICATION_BROWSER_PARTITION && partition !== SEARCH_PARTITION) {
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
