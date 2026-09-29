import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/session";

// Plain module: the Chrome extension authenticates every /api/extension/*
// call with the pairing code from settings → 浏览器插件. src/proxy.ts only
// lets extension-origin requests reach those routes at all; this is the check
// that the caller is *our* paired extension, not some other one.

export const EXTENSION_TOKEN_HEADER = "x-jobcompass-token";

export function hashExtensionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 24 random bytes, grouped for readability when copied by hand. */
export function newExtensionToken(): string {
  return randomBytes(24).toString("base64url").replace(/(.{8})(?=.)/g, "$1-");
}

/** null when authorised, otherwise the 401 to return. */
export async function rejectUnpairedExtension(request: Request): Promise<NextResponse | null> {
  const token = request.headers.get(EXTENSION_TOKEN_HEADER)?.trim();
  const user = await db.user.findUnique({ where: { id: LOCAL_USER_ID }, select: { extensionTokenHash: true } });
  if (!token || !user?.extensionTokenHash) {
    return NextResponse.json({ error: "插件还没和求职罗盘配对：在 App 的账号设置 → 浏览器插件里生成配对码" }, { status: 401 });
  }
  const given = Buffer.from(hashExtensionToken(token), "hex");
  const stored = Buffer.from(user.extensionTokenHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    return NextResponse.json({ error: "配对码无效或已重新生成，请在插件里重新填写" }, { status: 401 });
  }
  return null;
}
