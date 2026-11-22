"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const zlib = require("node:zlib");

const MAGIC = Buffer.from("CPLS", "ascii");
const AAD = Buffer.from("careerplatform-lan-sync-v1", "utf8");
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
const MAX_DECOMPRESSED_BYTES = 268435456; // 256 MB cap against zip bombs

/** Generates a cryptographically random 6-digit pairing code (100000-999999). */
function generatePairingCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function normalizePairingCode(raw) {
  return String(raw ?? "").replace(/\s+/g, "").trim();
}

function deriveKey(code, saltBuffer) {
  const normalized = normalizePairingCode(code);
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error("配对码必须为 6 位数字");
  }
  return crypto.scryptSync(normalized, saltBuffer, 32, SCRYPT_OPTS);
}

/**
 * Computes a short proof bound to a server-issued challenge so the receiver
 * proves knowledge of the 6-digit code before downloading megabytes of data.
 */
function computePairingProof(code, challengeHex) {
  const salt = Buffer.from(String(challengeHex ?? ""), "hex");
  if (salt.length < 8) throw new Error("无效的握手挑战码");
  const key = deriveKey(code, salt);
  return crypto.createHmac("sha256", key).update("careerplatform-lan-pull-v1").digest("hex");
}

function verifyPairingProof(providedHex, expectedHex) {
  if (typeof providedHex !== "string" || typeof expectedHex !== "string") return false;
  const a = Buffer.from(providedHex, "utf8");
  const b = Buffer.from(expectedHex, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Compresses (gzip) and encrypts (AES-256-GCM) a UTF-8 JSON backup string
 * into a compact binary envelope:
 *   [4B "CPLS"][4B headerLen BE][header JSON][raw ciphertext]
 */
function encryptLanPayload(plaintext, code, meta = {}) {
  const normalized = normalizePairingCode(code);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(normalized, salt);

  const rawBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), "utf8");
  const compressed = zlib.gzipSync(rawBuf, { level: 6 });

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  const headerObj = {
    v: 1,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    meta: {
      hostname: String(meta.hostname || os.hostname()).slice(0, 80),
      platform: String(meta.platform || process.platform),
      exportedAt: String(meta.exportedAt || new Date().toISOString()),
      files: Number(meta.files || 0),
      rawBytes: rawBuf.length,
    },
  };
  const headerBuf = Buffer.from(JSON.stringify(headerObj), "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(headerBuf.length, 0);

  return Buffer.concat([MAGIC, lenBuf, headerBuf, encrypted]);
}

/**
 * Verifies magic, decrypts AES-256-GCM envelope with the 6-digit code, and
 * decompresses the backup JSON payload safely.
 */
function decryptLanPayload(envelopeBuf, code) {
  const buf = Buffer.isBuffer(envelopeBuf) ? envelopeBuf : Buffer.from(envelopeBuf);
  if (buf.length < 12 || !buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error("数据包格式无效，请确认对方运行的是新版求职罗盘");
  }
  const headerLen = buf.readUInt32BE(4);
  if (headerLen <= 0 || headerLen > 65536 || 8 + headerLen > buf.length) {
    throw new Error("数据包头部损坏");
  }
  let header;
  try {
    header = JSON.parse(buf.subarray(8, 8 + headerLen).toString("utf8"));
  } catch {
    throw new Error("数据包头部无法解析");
  }
  if (!header || header.v !== 1 || !header.salt || !header.iv || !header.tag) {
    throw new Error("不支持的加密同步协议版本");
  }

  const salt = Buffer.from(header.salt, "hex");
  const iv = Buffer.from(header.iv, "hex");
  const tag = Buffer.from(header.tag, "hex");
  const ciphertext = buf.subarray(8 + headerLen);

  const key = deriveKey(code, salt);
  let compressed;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("配对码错误或传输数据已被篡改");
  }

  let raw;
  try {
    raw = zlib.gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch {
    throw new Error("数据包解压失败或超过 256MB 安全上限");
  }

  return {
    payload: raw.toString("utf8"),
    meta: header.meta || {},
  };
}

/** Checks whether a host is a private LAN IPv4 address, loopback, or mDNS .local name. */
function isPrivateLanHost(host) {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (/^[a-z0-9-]+\.local$/.test(h)) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map((n) => Number(n));
  if (parts.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

/**
 * Parses either a combined one-line token (`192.168.1.10:54321#482916`) or
 * separate address + 6-digit pairing code into validated `{ host, port, code }`.
 */
function parsePairingTarget(addressInput, codeInput = "") {
  let addr = String(addressInput ?? "").trim();
  let code = normalizePairingCode(codeInput);

  if (addr.includes("#")) {
    const [left, right] = addr.split("#", 2);
    addr = left.trim();
    if (!code && right) code = normalizePairingCode(right);
  }
  if (!addr) throw new Error("请输入发送方局域网地址（例如 192.168.1.10:54321）");
  if (!/^https?:\/\//i.test(addr)) addr = `http://${addr}`;

  let parsed;
  try {
    parsed = new URL(addr);
  } catch {
    throw new Error("局域网地址格式不正确，请使用 IP:端口 格式");
  }
  if (parsed.protocol !== "http:") {
    throw new Error("局域网直连仅支持内网 http://IP:端口 地址");
  }
  const host = parsed.hostname;
  const port = Number(parsed.port);
  if (!isPrivateLanHost(host)) {
    throw new Error("出于安全限制，只允许连接同一局域网内的私网地址（192.168.x.x / 10.x.x.x / 172.16-31.x.x）");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("端口号无效（需为 1024-65535）");
  }
  if (!/^\d{6}$/.test(code)) {
    throw new Error("请输入 6 位数字配对码");
  }

  return { host, port, code, baseUrl: `http://${host}:${port}` };
}

/** Lists candidate local LAN IPv4 addresses sorted with home/office Wi-Fi subnets first. */
function listLanAddresses(networkInterfacesFn = os.networkInterfaces) {
  const ifaces = networkInterfacesFn() || {};
  const found = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const info of list || []) {
      const family = typeof info.family === "number" ? (info.family === 4 ? "IPv4" : "IPv6") : info.family;
      if (family !== "IPv4" || info.internal) continue;
      if (!isPrivateLanHost(info.address)) continue;
      const priority =
        info.address.startsWith("192.168.") ? 1
        : info.address.startsWith("10.") ? 2
        : info.address.startsWith("172.") ? 3
        : 4;
      found.push({ name, address: info.address, priority });
    }
  }
  found.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const seen = new Set();
  return found.filter((item) => {
    if (seen.has(item.address)) return false;
    seen.add(item.address);
    return true;
  }).map(({ name, address }) => ({ name, address }));
}

module.exports = {
  generatePairingCode,
  normalizePairingCode,
  computePairingProof,
  verifyPairingProof,
  encryptLanPayload,
  decryptLanPayload,
  isPrivateLanHost,
  parsePairingTarget,
  listLanAddresses,
};
