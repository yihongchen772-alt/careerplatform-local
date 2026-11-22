"use strict";

const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const {
  generatePairingCode,
  computePairingProof,
  verifyPairingProof,
  encryptLanPayload,
  decryptLanPayload,
  parsePairingTarget,
  listLanAddresses,
} = require("./lan-sync-crypto");

const DEFAULT_SHARE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STAGED_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_FAILED_ATTEMPTS = 5;
const MAX_PULL_BYTES = 268435456; // 256 MB

function formatPlatformLabel(platform) {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  return platform || "桌面端";
}

function createLanSyncController({
  port,
  token,
  fetchLocalBackup,
  postLocalTransfer,
  ttlMs = DEFAULT_SHARE_TTL_MS,
  bindHost = "0.0.0.0",
} = {}) {
  let share = null; // { server, code, challenge, expectedProof, encryptedBuffer, port, addresses, expiresAt, timer, files, sizeMb, transferCount, failedAttempts }
  let staged = null; // { id, payload, meta, timer }

  const localFetchBackup = fetchLocalBackup || (async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data-transfer`, {
      method: "GET",
      headers: {
        ...(token ? { "x-desktop-token": token } : {}),
      },
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || typeof data.payload !== "string") {
      throw new Error(data?.message || `读取本机备份数据失败 (HTTP ${res.status})`);
    }
    return {
      payload: data.payload,
      files: Number(data.files || 0),
      exportedAt: String(data.exportedAt || new Date().toISOString()),
    };
  });

  const localTransfer = postLocalTransfer || (async (mode, payloadJson) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/data-transfer?mode=${mode}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-desktop-token": token } : {}),
      },
      body: payloadJson,
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      throw new Error(data?.message || `本地数据服务错误 (HTTP ${res.status})`);
    }
    return data;
  });

  function clearStaged() {
    if (staged?.timer) clearTimeout(staged.timer);
    staged = null;
  }

  function stopShare() {
    if (!share) return { active: false };
    const current = share;
    share = null;
    if (current.timer) clearTimeout(current.timer);
    try { current.server.close(); } catch { /* ignore */ }
    current.encryptedBuffer = null;
    return { active: false };
  }

  function getStatus() {
    if (!share) return { active: false };
    const primary = share.addresses[0]?.address || "127.0.0.1";
    const primaryAddress = `${primary}:${share.port}`;
    return {
      active: true,
      code: share.code,
      port: share.port,
      addresses: share.addresses.map((a) => ({ ...a, endpoint: `${a.address}:${share.port}` })),
      primaryAddress,
      pairingToken: `${primaryAddress}#${share.code}`,
      expiresAt: new Date(share.expiresAt).toISOString(),
      files: share.files,
      sizeMb: share.sizeMb,
      transferCount: share.transferCount,
      hostname: os.hostname(),
      platform: formatPlatformLabel(process.platform),
    };
  }

  async function startShare() {
    stopShare();

    const { payload, files, exportedAt } = await localFetchBackup();
    const code = generatePairingCode();
    const challenge = crypto.randomBytes(16).toString("hex");
    const expectedProof = computePairingProof(code, challenge);

    const encryptedBuffer = encryptLanPayload(payload, code, {
      hostname: os.hostname(),
      platform: process.platform,
      exportedAt,
      files,
    });

    const state = {
      server: null,
      code,
      challenge,
      expectedProof,
      encryptedBuffer,
      port: 0,
      addresses: listLanAddresses(),
      expiresAt: Date.now() + ttlMs,
      timer: null,
      files,
      sizeMb: (encryptedBuffer.length / 1024 / 1024).toFixed(2),
      transferCount: 0,
      failedAttempts: 0,
    };

    const server = http.createServer((req, res) => {
      if (share !== state) {
        res.writeHead(410, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "传输会话已关闭" }));
        return;
      }

      if (req.method === "GET" && req.url === "/info") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          ok: true,
          protocol: 1,
          hostname: os.hostname(),
          platform: formatPlatformLabel(process.platform),
          exportedAt,
          files: state.files,
          encryptedBytes: state.encryptedBuffer.length,
          challenge: state.challenge,
        }));
        return;
      }

      if (req.method === "POST" && req.url === "/pull") {
        const providedProof = String(req.headers["x-pairing-proof"] || "");
        if (!verifyPairingProof(providedProof, state.expectedProof)) {
          state.failedAttempts += 1;
          const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - state.failedAttempts);
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({
            ok: false,
            message: remaining > 0
              ? `配对码不正确（还剩 ${remaining} 次机会）`
              : "错误次数过多，发送端已自动关闭加密传输会话",
          }));
          if (state.failedAttempts >= MAX_FAILED_ATTEMPTS) {
            setImmediate(() => { if (share === state) stopShare(); });
          }
          return;
        }

        state.transferCount += 1;
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(state.encryptedBuffer.length),
          "Cache-Control": "no-store",
        });
        res.end(state.encryptedBuffer);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "Not found" }));
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, bindHost, () => {
        server.off("error", reject);
        resolve();
      });
    });

    const addr = server.address();
    state.server = server;
    state.port = typeof addr === "object" && addr ? addr.port : 0;
    state.timer = setTimeout(() => {
      if (share === state) stopShare();
    }, ttlMs);
    if (typeof state.timer.unref === "function") state.timer.unref();
    share = state;

    return getStatus();
  }

  async function pullFromPeer({ address, code }) {
    const target = parsePairingTarget(address, code);

    // 1. Handshake to get sender metadata + random challenge
    let infoRes;
    try {
      infoRes = await fetch(`${target.baseUrl}/info`, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new Error("无法连接到发送端，请确认两台电脑在同一个 Wi-Fi / 局域网，且对方已开启发送模式");
    }
    const info = await infoRes.json().catch(() => null);
    if (!infoRes.ok || !info?.ok || !info.challenge) {
      throw new Error(info?.message || "发送端响应异常或已关闭分享");
    }

    // 2. Prove pairing code and download encrypted binary blob
    const proof = computePairingProof(target.code, info.challenge);
    const pullRes = await fetch(`${target.baseUrl}/pull`, {
      method: "POST",
      headers: { "x-pairing-proof": proof },
      signal: AbortSignal.timeout(120000),
    });
    if (!pullRes.ok) {
      const errBody = await pullRes.json().catch(() => null);
      throw new Error(errBody?.message || `拉取失败 (HTTP ${pullRes.status})`);
    }

    const contentLength = Number(pullRes.headers.get("content-length") || 0);
    if (contentLength > MAX_PULL_BYTES) {
      throw new Error("对方数据包超过 256MB 安全上限");
    }

    const arrayBuf = await pullRes.arrayBuffer();
    if (arrayBuf.byteLength > MAX_PULL_BYTES) {
      throw new Error("对方数据包超过 256MB 安全上限");
    }

    // 3. Decrypt & decompress with AES-256-GCM
    const { payload, meta } = decryptLanPayload(Buffer.from(arrayBuf), target.code);

    // 4. Ask local Next server to validate & preview backup contents
    const previewRes = await localTransfer("preview", payload);
    if (!previewRes.ok) {
      throw new Error(previewRes.message || "数据包校验未通过");
    }

    clearStaged();
    const stagingId = crypto.randomUUID();
    const timer = setTimeout(() => {
      if (staged?.id === stagingId) clearStaged();
    }, STAGED_TTL_MS);
    if (typeof timer.unref === "function") timer.unref();
    staged = { id: stagingId, payload, meta, timer };

    return {
      ok: true,
      stagingId,
      sender: {
        hostname: info.hostname || meta.hostname || "另一台电脑",
        platform: info.platform || formatPlatformLabel(meta.platform),
        sizeMb: (arrayBuf.byteLength / 1024 / 1024).toFixed(2),
      },
      preview: previewRes.data,
    };
  }

  async function confirmImport(stagingId) {
    if (!staged || staged.id !== stagingId) {
      return { ok: false, message: "待恢复的数据包已过期，请重新从对方电脑拉取" };
    }
    const payload = staged.payload;
    const res = await localTransfer("import", payload);
    if (res.ok) clearStaged();
    return res;
  }

  function discardStaged(stagingId) {
    if (!stagingId || staged?.id === stagingId) clearStaged();
    return { ok: true };
  }

  function shutdown() {
    stopShare();
    clearStaged();
  }

  return {
    getStatus,
    startShare,
    stopShare,
    pullFromPeer,
    confirmImport,
    discardStaged,
    shutdown,
  };
}

function setupLanSync({ port, token, ipcMain, trustedOrigin }) {
  const controller = createLanSyncController({ port, token });

  const assertTrusted = (event) => {
    const url = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
    try {
      if (trustedOrigin && new URL(url).origin !== trustedOrigin) {
        throw new Error("不受信任的调用来源");
      }
    } catch {
      throw new Error("不受信任的调用来源");
    }
  };

  const wrap = (fn) => async (event, ...args) => {
    assertTrusted(event);
    try {
      return await fn(...args);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  };

  ipcMain.handle("lan-sync:status", wrap(() => ({ ok: true, data: controller.getStatus() })));
  ipcMain.handle("lan-sync:start", wrap(async () => ({ ok: true, data: await controller.startShare() })));
  ipcMain.handle("lan-sync:stop", wrap(() => ({ ok: true, data: controller.stopShare() })));
  ipcMain.handle("lan-sync:pull", wrap((args) => controller.pullFromPeer(args || {})));
  ipcMain.handle("lan-sync:confirm-import", wrap((stagingId) => controller.confirmImport(stagingId)));
  ipcMain.handle("lan-sync:discard", wrap((stagingId) => controller.discardStaged(stagingId)));

  return controller;
}

module.exports = {
  createLanSyncController,
  setupLanSync,
};
