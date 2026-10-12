const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// 网申浏览器 saved passwords. Each 网申 site wants its own account, and a
// 秋招 season means dozens of them; like Chrome, the browser offers to keep
// them and fills them in next time.
//
// Kept out of the database on purpose: not in JSON backups, not reachable
// from the Next server. Encrypted at rest (AES-256-GCM) with a key derived
// from the same per-install .secret the App already uses for AI keys and
// mailbox passwords — the OS keychain was not used because an ad-hoc signed
// update would make macOS ask for it again after every update.

/**
 * Which account store a page belongs to. Usually the origin; on shared
 * recruiting hosts (Moka, hotjob…) one host serves many companies, each with
 * its own accounts, so the company's part of the address is included.
 */
function loginRealm(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const segments = url.pathname.split("/").filter(Boolean);
  if (/(^|\.)mokahr\.com$/i.test(url.hostname)) {
    const at = segments.findIndex((segment) => /^(?:campus-recruitment|social-recruitment|recommendation-apply|campus_apply|apply)$/i.test(segment));
    if (at >= 0 && segments[at + 1]) return `${url.origin}/${segments[at + 1].toLowerCase()}`;
  }
  if (/(^|\.)hotjob\.cn$/i.test(url.hostname) && segments[0] && /^SU[0-9a-z]{6,}$/i.test(segments[0])) return `${url.origin}/${segments[0]}`;
  const tenant = [...url.searchParams].filter(([key]) => /^(?:company|companyId|tenant|tenantId|orgId|orgid)$/i.test(key)).sort(([a], [b]) => a.localeCompare(b));
  if (tenant.length && /(?:mokahr|beisen|zhiye|hotjob|zhaopin|nowcoder|51job|liepin)\./i.test(url.hostname)) return `${url.origin}?${new URLSearchParams(tenant)}`;
  return url.origin;
}

/** 「app.mokahr.com/bytedance」 — how a realm is shown to the applicant. */
function realmLabel(realm) {
  return String(realm || "").replace(/^https?:\/\//i, "");
}

function createLoginStore({ dir }) {
  const file = path.join(dir, "saved-logins.json");
  let key = null;
  function cipherKey() {
    if (key) return key;
    const secret = fs.readFileSync(path.join(dir, ".secret"), "utf8").trim();
    if (!secret) throw new Error("missing secret");
    key = crypto.scryptSync(secret, "careerplatform-saved-logins", 32);
    return key;
  }
  function seal(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", cipherKey(), iv);
    const body = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
    return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${body.toString("hex")}`;
  }
  function open(sealed) {
    const [iv, tag, body] = String(sealed || "").split(":");
    if (!iv || !tag || !body) return null;
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(iv, "hex"));
      decipher.setAuthTag(Buffer.from(tag, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(body, "hex")), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }
  function read() {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return {
        logins: Array.isArray(data.logins) ? data.logins.filter((login) => login && typeof login.id === "string" && typeof login.realm === "string") : [],
        never: Array.isArray(data.never) ? data.never.filter((value) => typeof value === "string") : [],
      };
    } catch {
      return { logins: [], never: [] };
    }
  }
  function write(data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, logins: data.logins, never: data.never }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  const visible = (login) => ({ id: login.id, realm: login.realm, site: realmLabel(login.realm), username: login.username, createdAt: login.createdAt, updatedAt: login.updatedAt, lastUsedAt: login.lastUsedAt || null });

  return {
    /** Accounts for exactly this site. */
    forRealm(realm) {
      return read().logins.filter((login) => login.realm === realm).map(visible);
    },
    /** Accounts on the same host but another company's part of it. */
    nearby(realm) {
      let origin;
      try { origin = new URL(realm.replace(/\?.*$/, "")).origin; } catch { return []; }
      return read().logins.filter((login) => login.realm !== realm && login.realm.startsWith(origin)).map(visible);
    },
    list() {
      return read().logins.map(visible).sort((a, b) => a.site.localeCompare(b.site) || a.username.localeCompare(b.username));
    },
    get(id) {
      const login = read().logins.find((entry) => entry.id === id);
      if (!login) return null;
      const password = open(login.password);
      return password === null ? null : { ...visible(login), password };
    },
    /** Is this exact account (with this password) already kept? */
    status(realm, username, password) {
      const login = read().logins.find((entry) => entry.realm === realm && entry.username === username);
      if (!login) return "new";
      return open(login.password) === password ? "same" : "changed";
    },
    save(realm, username, password) {
      const data = read();
      const now = Date.now();
      const existing = data.logins.find((entry) => entry.realm === realm && entry.username === username);
      if (existing) {
        existing.password = seal(password);
        existing.updatedAt = now;
        existing.lastUsedAt = now;
      } else {
        data.logins.push({ id: crypto.randomUUID(), realm, username, password: seal(password), createdAt: now, updatedAt: now, lastUsedAt: now });
      }
      write(data);
      return existing ? existing.id : data.logins[data.logins.length - 1].id;
    },
    touch(id) {
      const data = read();
      const login = data.logins.find((entry) => entry.id === id);
      if (!login) return;
      login.lastUsedAt = Date.now();
      write(data);
    },
    remove(id) {
      const data = read();
      const before = data.logins.length;
      data.logins = data.logins.filter((entry) => entry.id !== id);
      if (data.logins.length !== before) write(data);
      return data.logins.length !== before;
    },
    isNever(realm) {
      return read().never.includes(realm);
    },
    addNever(realm) {
      const data = read();
      if (!data.never.includes(realm)) data.never.push(realm);
      write(data);
    },
    neverList() {
      return read().never.map((realm) => ({ realm, site: realmLabel(realm) }));
    },
    removeNever(realm) {
      const data = read();
      data.never = data.never.filter((value) => value !== realm);
      write(data);
    },
  };
}

module.exports = { createLoginStore, loginRealm, realmLabel };
