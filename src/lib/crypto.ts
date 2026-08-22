import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

/**
 * At-rest encryption for user-supplied AI API keys. Reuses NEXTAUTH_SECRET
 * as key material rather than requiring a second secret to provision in
 * every environment — it's already a private, high-entropy value nothing
 * else exposes.
 */
const ALGORITHM = "aes-256-gcm";

function deriveKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET 未配置，无法加密/解密 API Key");
  }
  return scryptSync(secret, "careerplatform-ai-key", 32);
}

/** Returns `iv:authTag:ciphertext`, all hex — safe to store in a text column. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("存储的密钥格式异常");
  }
  const key = deriveKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Last 4 chars only — enough for the user to recognize which key is saved. */
export function maskKey(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return `••••${plaintext.slice(-4)}`;
}
