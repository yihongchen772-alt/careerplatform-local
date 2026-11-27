"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_PROFILE_ID = "default";
const DEFAULT_PROFILE_NAME = "我的档案";
// Must match the historical partition so upgrading users retain 100% of their
// existing recruitment portal logins (字节/腾讯/北森/Moka, etc.).
const DEFAULT_BROWSER_PARTITION = "persist:job-application-browser";
const LOCAL_USER_ID = "local-user";
const AI_KEY_SALT = "careerplatform-ai-key";
const AI_CIPHER_ALGO = "aes-256-gcm";

const PROFILE_COLORS = ["blue", "rose", "amber", "emerald", "violet", "cyan"];
const SECONDARY_COLORS = ["rose", "amber", "emerald", "violet", "cyan"];

function isValidProfileId(id) {
  if (typeof id !== "string") return false;
  if (id === DEFAULT_PROFILE_ID) return true;
  return /^[a-z0-9][a-z0-9_-]{1,47}$/.test(id);
}

function sanitizeProfileName(rawName, fallback = "") {
  const trimmed = String(rawName ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 32);
}

function normalizeProfileColor(color, index = 0, isDefault = false) {
  if (typeof color === "string" && PROFILE_COLORS.includes(color)) return color;
  if (isDefault) return "blue";
  return SECONDARY_COLORS[Math.max(0, index) % SECONDARY_COLORS.length];
}

/**
 * Browser session partition for a profile.
 * Default profile keeps the original `persist:job-application-browser` so
 * existing cookies and site sessions are preserved without loss; every
 * additional profile gets its own physically isolated Chromium partition.
 */
function browserPartitionForProfile(profileId = DEFAULT_PROFILE_ID) {
  const resolved = profileId ?? DEFAULT_PROFILE_ID;
  if (!isValidProfileId(resolved)) {
    throw new Error(`非法求职人档案 ID: ${String(profileId)}`);
  }
  if (resolved === DEFAULT_PROFILE_ID) return DEFAULT_BROWSER_PARTITION;
  return `${DEFAULT_BROWSER_PARTITION}-${resolved}`;
}

function isAllowedBrowserPartition(partition) {
  if (typeof partition !== "string") return false;
  if (partition === DEFAULT_BROWSER_PARTITION) return true;
  const prefix = `${DEFAULT_BROWSER_PARTITION}-`;
  if (!partition.startsWith(prefix)) return false;
  const profileId = partition.slice(prefix.length);
  return profileId !== DEFAULT_PROFILE_ID && isValidProfileId(profileId);
}

/**
 * Resolves the physical storage directory for a profile.
 * Default profile stays directly in `rootUserData` (<rootUserData>/local.db,
 * .secret, uploads/) for 100% backward compatibility. Non-default profiles
 * live under `<rootUserData>/profiles/<profileId>/`.
 */
function resolveProfileDataDir(rootUserData, profileId = DEFAULT_PROFILE_ID) {
  if (!rootUserData || typeof rootUserData !== "string") {
    throw new Error("rootUserData 不能为空");
  }
  const root = path.resolve(rootUserData);
  const resolvedId = profileId ?? DEFAULT_PROFILE_ID;
  if (!isValidProfileId(resolvedId)) {
    throw new Error(`非法求职人档案 ID: ${String(profileId)}`);
  }
  if (resolvedId === DEFAULT_PROFILE_ID) return root;
  const profilesDir = path.join(root, "profiles");
  const target = path.resolve(profilesDir, resolvedId);
  const rel = path.relative(profilesDir, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || rel.includes(path.sep)) {
    throw new Error("非法求职人档案存储路径");
  }
  return target;
}

function profilesStateFile(rootUserData) {
  return path.join(path.resolve(rootUserData), "profiles.json");
}

function atomicWriteJson(filePath, payload) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
}

function defaultProfileEntry(overrides = {}) {
  return {
    id: DEFAULT_PROFILE_ID,
    name: sanitizeProfileName(overrides.name, DEFAULT_PROFILE_NAME),
    color: normalizeProfileColor(overrides.color, 0, true),
    createdAt: typeof overrides.createdAt === "string" && overrides.createdAt ? overrides.createdAt : new Date().toISOString(),
  };
}

/**
 * Reads `<rootUserData>/profiles.json` without creating files on disk if absent.
 * Keeping reads side-effect-free guarantees zero intrusion on existing installs
 * and isolated test directories (`CAREERPLATFORM_TEST_MODE=1` / `CAREERPLATFORM_DATA_DIR`).
 */
function readProfilesState(rootUserData) {
  const file = profilesStateFile(rootUserData);
  let raw = null;
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      raw = null;
    }
  }

  const seen = new Set();
  const normalized = [];

  const rawList = Array.isArray(raw?.profiles) ? raw.profiles : [];
  const existingDefault = rawList.find((item) => item && item.id === DEFAULT_PROFILE_ID);
  normalized.push(defaultProfileEntry(existingDefault || {}));
  seen.add(DEFAULT_PROFILE_ID);

  let secondaryIndex = 0;
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim();
    if (!id || seen.has(id) || !isValidProfileId(id)) continue;
    const name = sanitizeProfileName(item.name);
    if (!name) continue;
    seen.add(id);
    normalized.push({
      id,
      name,
      color: normalizeProfileColor(item.color, secondaryIndex++, false),
      createdAt: typeof item.createdAt === "string" && item.createdAt ? item.createdAt : new Date().toISOString(),
    });
  }

  const requestedActive = typeof raw?.activeProfileId === "string" ? raw.activeProfileId : DEFAULT_PROFILE_ID;
  const activeProfileId = seen.has(requestedActive) ? requestedActive : DEFAULT_PROFILE_ID;

  return {
    version: 1,
    activeProfileId,
    profiles: normalized,
  };
}

function writeProfilesState(rootUserData, state) {
  const payload = {
    version: 1,
    activeProfileId: state.activeProfileId || DEFAULT_PROFILE_ID,
    profiles: state.profiles,
  };
  atomicWriteJson(profilesStateFile(rootUserData), payload);
  return payload;
}

function ensureProfileSecret(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const secretFile = path.join(dataDir, ".secret");
  if (fs.existsSync(secretFile)) {
    const existing = fs.readFileSync(secretFile, "utf8").trim();
    if (existing) return existing;
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

function deriveAiKeyBuffer(secret) {
  const trimmed = String(secret || "").trim();
  if (!trimmed) throw new Error("加密密钥 (.secret) 为空");
  return crypto.scryptSync(trimmed, AI_KEY_SALT, 32);
}

/** Matches `encryptSecret` in `src/lib/crypto.ts` byte-for-byte. */
function encryptAiKeyWithSecret(plaintext, secret) {
  const key = deriveAiKeyBuffer(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(AI_CIPHER_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Matches `decryptSecret` in `src/lib/crypto.ts` byte-for-byte. */
function decryptAiKeyWithSecret(stored, secret) {
  const [ivHex, authTagHex, ciphertextHex] = String(stored || "").split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("存储的密钥格式异常");
  }
  const key = deriveAiKeyBuffer(secret);
  const decipher = crypto.createDecipheriv(AI_CIPHER_ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

function meaningfulRealName(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed || trimmed === "我" || trimmed === "me@local") return null;
  return trimmed.slice(0, 40);
}

function formatProfileDisplayName(profile, userRealName) {
  const baseName = sanitizeProfileName(profile?.name, DEFAULT_PROFILE_NAME);
  const real = meaningfulRealName(userRealName);
  if (!real) return baseName;
  if (baseName === real || baseName.includes(real)) return baseName;
  return `${baseName} (${real})`;
}

/**
 * Safely reads summary metadata (`User.name`, counts) from a profile's SQLite
 * database if initialized. Never throws or creates a database file.
 */
function inspectProfileDbSummary(dataDir) {
  const dbPath = path.join(dataDir, "local.db");
  if (!fs.existsSync(dbPath)) {
    return { initialized: false, userRealName: null, applicationCount: 0, resumeCount: 0, aiKeyCount: 0 };
  }
  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 2000 });
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name)
    );
    let userRealName = null;
    if (tables.has("User")) {
      const row =
        db.prepare('SELECT "name" FROM "User" WHERE "id" = ? LIMIT 1').get(LOCAL_USER_ID) ||
        db.prepare('SELECT "name" FROM "User" LIMIT 1').get();
      userRealName = meaningfulRealName(row?.name);
    }
    const countTable = (name) =>
      tables.has(name) ? Number(db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()?.count || 0) : 0;
    return {
      initialized: tables.has("User"),
      userRealName,
      applicationCount: countTable("Application"),
      resumeCount: countTable("ResumeVersion"),
      aiKeyCount: countTable("AiKey"),
    };
  } catch {
    return { initialized: false, userRealName: null, applicationCount: 0, resumeCount: 0, aiKeyCount: 0 };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

function listProfilesDetailed(rootUserData) {
  const state = readProfilesState(rootUserData);
  const profiles = state.profiles.map((profile) => {
    const dataDir = resolveProfileDataDir(rootUserData, profile.id);
    const summary = inspectProfileDbSummary(dataDir);
    return {
      id: profile.id,
      name: profile.name,
      color: profile.color,
      createdAt: profile.createdAt,
      isDefault: profile.id === DEFAULT_PROFILE_ID,
      displayName: formatProfileDisplayName(profile, summary.userRealName),
      userRealName: summary.userRealName,
      applicationCount: summary.applicationCount,
      resumeCount: summary.resumeCount,
      aiKeyCount: summary.aiKeyCount,
      initialized: summary.initialized,
      browserPartition: browserPartitionForProfile(profile.id),
      dataDir,
    };
  });
  return {
    activeProfileId: state.activeProfileId,
    profiles,
  };
}

function createProfile(rootUserData, { name, color } = {}) {
  const cleanName = sanitizeProfileName(name);
  if (!cleanName) {
    throw new Error("请输入求职人名称（例如：对象）");
  }
  const state = readProfilesState(rootUserData);
  let id = "";
  for (let i = 0; i < 10; i++) {
    const candidate = `p-${crypto.randomBytes(6).toString("hex")}`;
    if (!state.profiles.some((p) => p.id === candidate)) {
      id = candidate;
      break;
    }
  }
  if (!id) throw new Error("无法生成唯一档案标识，请重试");

  const nonDefaultCount = state.profiles.filter((p) => p.id !== DEFAULT_PROFILE_ID).length;
  const resolvedColor = normalizeProfileColor(color, nonDefaultCount, false);
  const entry = {
    id,
    name: cleanName,
    color: resolvedColor,
    createdAt: new Date().toISOString(),
  };

  const dataDir = resolveProfileDataDir(rootUserData, id);
  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  ensureProfileSecret(dataDir);

  state.profiles.push(entry);
  writeProfilesState(rootUserData, state);

  return {
    ...entry,
    isDefault: false,
    displayName: cleanName,
    userRealName: null,
    applicationCount: 0,
    resumeCount: 0,
    aiKeyCount: 0,
    initialized: false,
    browserPartition: browserPartitionForProfile(id),
    dataDir,
  };
}

function renameProfile(rootUserData, profileId, newName) {
  if (!isValidProfileId(profileId)) {
    throw new Error("非法求职人档案 ID");
  }
  const cleanName = sanitizeProfileName(newName);
  if (!cleanName) {
    throw new Error("档案名称不能为空");
  }
  const state = readProfilesState(rootUserData);
  const target = state.profiles.find((p) => p.id === profileId);
  if (!target) {
    throw new Error("未找到对应的求职人档案");
  }
  target.name = cleanName;
  writeProfilesState(rootUserData, state);
  return { ...target };
}

function setActiveProfile(rootUserData, profileId) {
  if (!isValidProfileId(profileId)) {
    throw new Error("非法求职人档案 ID");
  }
  const state = readProfilesState(rootUserData);
  const target = state.profiles.find((p) => p.id === profileId);
  if (!target) {
    throw new Error("目标求职人档案不存在");
  }
  state.activeProfileId = profileId;
  // Only persist profiles.json when multi-profile state already exists or when
  // switching away from default, preserving zero-file footprint for single-profile runs.
  if (profileId !== DEFAULT_PROFILE_ID || fs.existsSync(profilesStateFile(rootUserData))) {
    writeProfilesState(rootUserData, state);
  }
  return {
    ...target,
    isDefault: target.id === DEFAULT_PROFILE_ID,
    dataDir: resolveProfileDataDir(rootUserData, target.id),
    browserPartition: browserPartitionForProfile(target.id),
  };
}

function removeProfileDirectorySafely(rootUserData, dirToRemove) {
  if (!fs.existsSync(dirToRemove)) return;
  const profilesDir = path.join(path.resolve(rootUserData), "profiles");
  if (!fs.existsSync(profilesDir)) return;
  const realParent = fs.realpathSync(profilesDir);
  const stat = fs.lstatSync(dirToRemove);
  if (stat.isSymbolicLink()) {
    throw new Error("拒绝删除符号链接目录");
  }
  const realTarget = fs.realpathSync(dirToRemove);
  if (path.dirname(realTarget) !== realParent) {
    throw new Error("拒绝删除 profiles 目录之外的数据");
  }
  fs.rmSync(realTarget, { recursive: true, force: true });
}

function deleteProfile(rootUserData, profileId) {
  if (profileId === DEFAULT_PROFILE_ID) {
    throw new Error("默认主档案不可删除");
  }
  if (!isValidProfileId(profileId)) {
    throw new Error("非法求职人档案 ID");
  }
  const state = readProfilesState(rootUserData);
  const idx = state.profiles.findIndex((p) => p.id === profileId);
  if (idx === -1) {
    throw new Error("未找到要删除的求职人档案");
  }

  const dataDir = resolveProfileDataDir(rootUserData, profileId);
  removeProfileDirectorySafely(rootUserData, dataDir);
  removeProfileDirectorySafely(rootUserData, `${dataDir}-backups`);

  state.profiles.splice(idx, 1);
  const switchedToDefault = state.activeProfileId === profileId;
  if (switchedToDefault) {
    state.activeProfileId = DEFAULT_PROFILE_ID;
  }
  writeProfilesState(rootUserData, state);

  return {
    deletedId: profileId,
    activeProfileId: state.activeProfileId,
    switchedToDefault,
    partitionToClear: browserPartitionForProfile(profileId),
  };
}

function readSourceAiBundle(dataDir) {
  const secretFile = path.join(dataDir, ".secret");
  const dbPath = path.join(dataDir, "local.db");
  if (!fs.existsSync(secretFile) || !fs.existsSync(dbPath)) return null;
  const secret = fs.readFileSync(secretFile, "utf8").trim();
  if (!secret) return null;

  let db = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, timeout: 3000 });
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    );
    if (!tables.has("AiKey")) return null;

    const aiKeyColumns = new Set(
      db.prepare('PRAGMA table_info("AiKey")').all().map((col) => col.name)
    );
    const selectBaseUrl = aiKeyColumns.has("baseUrl") ? '"baseUrl"' : "NULL AS baseUrl";
    const selectModel = aiKeyColumns.has("model") ? '"model"' : "NULL AS model";
    const selectUpdatedAt = aiKeyColumns.has("updatedAt") ? '"updatedAt"' : "NULL AS updatedAt";

    const rows = db
      .prepare(`SELECT "provider", "apiKeyEncrypted", ${selectModel}, ${selectBaseUrl}, ${selectUpdatedAt} FROM "AiKey"`)
      .all();

    const decryptedKeys = [];
    for (const row of rows) {
      if (!row?.provider || !row?.apiKeyEncrypted) continue;
      try {
        const apiKeyPlain = decryptAiKeyWithSecret(row.apiKeyEncrypted, secret);
        if (apiKeyPlain) {
          decryptedKeys.push({
            provider: String(row.provider),
            apiKeyPlain,
            model: row.model ?? null,
            baseUrl: row.baseUrl ?? null,
            updatedAt: row.updatedAt ?? null,
          });
        }
      } catch {
        // Ignore unreadable key rows rather than failing the whole sync.
      }
    }

    let userPrefs = { defaultAiProvider: null, agentAiProvider: null, agentAiModel: null };
    if (tables.has("User")) {
      const userCols = new Set(db.prepare('PRAGMA table_info("User")').all().map((c) => c.name));
      const cols = ["defaultAiProvider", "agentAiProvider", "agentAiModel"].filter((c) => userCols.has(c));
      if (cols.length > 0) {
        const sqlCols = cols.map((c) => `"${c}"`).join(", ");
        const userRow =
          db.prepare(`SELECT ${sqlCols} FROM "User" WHERE "id" = ? LIMIT 1`).get(LOCAL_USER_ID) ||
          db.prepare(`SELECT ${sqlCols} FROM "User" LIMIT 1`).get();
        if (userRow) {
          userPrefs = {
            defaultAiProvider: userRow.defaultAiProvider ?? null,
            agentAiProvider: userRow.agentAiProvider ?? null,
            agentAiModel: userRow.agentAiModel ?? null,
          };
        }
      }
    }

    return { keys: decryptedKeys, userPrefs };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/**
 * Decrypts `AiKey` credentials + `User` AI provider preferences from the
 * default profile (or another profile with configured keys) using its `.secret`,
 * and re-encrypts them into `targetProfileId`'s `local.db` using the target's
 * own `.secret`. Never logs or returns plaintext keys.
 */
function syncAiKeysForProfile(rootUserData, targetProfileId, { sourceProfileId, overwrite = false } = {}) {
  if (!isValidProfileId(targetProfileId)) {
    throw new Error("非法目标档案 ID");
  }
  const targetDir = resolveProfileDataDir(rootUserData, targetProfileId);
  const targetDbPath = path.join(targetDir, "local.db");
  if (!fs.existsSync(targetDbPath)) {
    return { ok: true, synced: 0, skipped: 0, providers: [], sourceProfileId: null };
  }
  const targetSecret = ensureProfileSecret(targetDir);

  const state = readProfilesState(rootUserData);
  const orderedCandidates = [];
  if (sourceProfileId && sourceProfileId !== targetProfileId && isValidProfileId(sourceProfileId)) {
    orderedCandidates.push(sourceProfileId);
  }
  if (DEFAULT_PROFILE_ID !== targetProfileId && !orderedCandidates.includes(DEFAULT_PROFILE_ID)) {
    orderedCandidates.push(DEFAULT_PROFILE_ID);
  }
  for (const profile of state.profiles) {
    if (profile.id !== targetProfileId && !orderedCandidates.includes(profile.id)) {
      orderedCandidates.push(profile.id);
    }
  }

  const keyByProvider = new Map();
  let chosenSourceId = null;
  let chosenUserPrefs = { defaultAiProvider: null, agentAiProvider: null, agentAiModel: null };

  for (const candidateId of orderedCandidates) {
    const candidateDir = resolveProfileDataDir(rootUserData, candidateId);
    const bundle = readSourceAiBundle(candidateDir);
    if (!bundle || bundle.keys.length === 0) continue;
    if (!chosenSourceId) {
      chosenSourceId = candidateId;
      chosenUserPrefs = bundle.userPrefs;
    }
    for (const item of bundle.keys) {
      if (!keyByProvider.has(item.provider)) {
        keyByProvider.set(item.provider, item);
      }
    }
  }

  if (keyByProvider.size === 0) {
    return { ok: true, synced: 0, skipped: 0, providers: [], sourceProfileId: null };
  }

  let targetDb = null;
  let synced = 0;
  let skipped = 0;
  const syncedProviders = [];
  try {
    targetDb = new DatabaseSync(targetDbPath, { timeout: 5000 });
    const tables = new Set(
      targetDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    );
    if (!tables.has("AiKey") || !tables.has("User")) {
      return { ok: true, synced: 0, skipped: 0, providers: [], sourceProfileId: null };
    }

    const nowIso = new Date().toISOString();
    const userCols = new Set(targetDb.prepare('PRAGMA table_info("User")').all().map((c) => c.name));
    const existingUser =
      targetDb.prepare('SELECT "id", "email" FROM "User" WHERE "id" = ? LIMIT 1').get(LOCAL_USER_ID) ||
      targetDb.prepare('SELECT "id", "email" FROM "User" LIMIT 1').get();

    const targetUserId = existingUser ? existingUser.id : LOCAL_USER_ID;
    if (!existingUser) {
      if (userCols.has("createdAt")) {
        targetDb
          .prepare('INSERT INTO "User" ("id", "email", "name", "createdAt") VALUES (?, ?, ?, ?)')
          .run(LOCAL_USER_ID, "me@local", "我", nowIso);
      } else {
        targetDb
          .prepare('INSERT INTO "User" ("id", "email", "name") VALUES (?, ?, ?)')
          .run(LOCAL_USER_ID, "me@local", "我");
      }
    }

    const aiCols = new Set(targetDb.prepare('PRAGMA table_info("AiKey")').all().map((c) => c.name));
    const hasBaseUrl = aiCols.has("baseUrl");

    for (const [provider, item] of keyByProvider.entries()) {
      const existingKey = targetDb
        .prepare('SELECT "id" FROM "AiKey" WHERE "userId" = ? AND "provider" = ? LIMIT 1')
        .get(targetUserId, provider);

      if (existingKey && !overwrite) {
        skipped += 1;
        continue;
      }

      const reEncrypted = encryptAiKeyWithSecret(item.apiKeyPlain, targetSecret);
      if (existingKey) {
        if (hasBaseUrl) {
          targetDb
            .prepare(
              'UPDATE "AiKey" SET "apiKeyEncrypted" = ?, "model" = COALESCE(?, "model"), "baseUrl" = ?, "updatedAt" = ? WHERE "id" = ?'
            )
            .run(reEncrypted, item.model, item.baseUrl, nowIso, existingKey.id);
        } else {
          targetDb
            .prepare(
              'UPDATE "AiKey" SET "apiKeyEncrypted" = ?, "model" = COALESCE(?, "model"), "updatedAt" = ? WHERE "id" = ?'
            )
            .run(reEncrypted, item.model, nowIso, existingKey.id);
        }
      } else {
        const newId = `aikey_${crypto.randomBytes(12).toString("hex")}`;
        if (hasBaseUrl) {
          targetDb
            .prepare(
              'INSERT INTO "AiKey" ("id", "userId", "provider", "apiKeyEncrypted", "model", "baseUrl", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )
            .run(newId, targetUserId, provider, reEncrypted, item.model, item.baseUrl, nowIso, nowIso);
        } else {
          targetDb
            .prepare(
              'INSERT INTO "AiKey" ("id", "userId", "provider", "apiKeyEncrypted", "model", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)'
            )
            .run(newId, targetUserId, provider, reEncrypted, item.model, nowIso, nowIso);
        }
      }
      synced += 1;
      syncedProviders.push(provider);
    }

    // Sync defaultAiProvider / agentAiProvider / agentAiModel onto target User
    const prefFields = ["defaultAiProvider", "agentAiProvider", "agentAiModel"].filter((f) => userCols.has(f));
    if (prefFields.length > 0) {
      const curPrefs = targetDb
        .prepare(`SELECT ${prefFields.map((f) => `"${f}"`).join(", ")} FROM "User" WHERE "id" = ? LIMIT 1`)
        .get(targetUserId);
      for (const field of prefFields) {
        const incoming = chosenUserPrefs[field];
        if (!incoming) continue;
        if (overwrite || !curPrefs || !curPrefs[field]) {
          targetDb.prepare(`UPDATE "User" SET "${field}" = ? WHERE "id" = ?`).run(incoming, targetUserId);
        }
      }
    }

    return {
      ok: true,
      synced,
      skipped,
      providers: syncedProviders,
      sourceProfileId: chosenSourceId,
    };
  } finally {
    // Wipe decrypted plaintext copies in memory best-effort
    for (const item of keyByProvider.values()) {
      item.apiKeyPlain = "";
    }
    try { targetDb?.close(); } catch { /* ignore */ }
  }
}

module.exports = {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  DEFAULT_BROWSER_PARTITION,
  PROFILE_COLORS,
  isValidProfileId,
  sanitizeProfileName,
  browserPartitionForProfile,
  isAllowedBrowserPartition,
  resolveProfileDataDir,
  profilesStateFile,
  readProfilesState,
  writeProfilesState,
  ensureProfileSecret,
  encryptAiKeyWithSecret,
  decryptAiKeyWithSecret,
  formatProfileDisplayName,
  inspectProfileDbSummary,
  listProfilesDetailed,
  createProfile,
  renameProfile,
  setActiveProfile,
  deleteProfile,
  syncAiKeysForProfile,
};
