"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, type ActionResult } from "@/lib/action-result";
import { hashExtensionToken, newExtensionToken } from "@/lib/extension-auth";

export type ExtensionPairing = { paired: boolean; pairedAt: string | null };

export async function getExtensionPairing(): Promise<ExtensionPairing> {
  const user = await requireUser();
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { extensionTokenHash: true, extensionPairedAt: true } });
  return { paired: !!row.extensionTokenHash, pairedAt: row.extensionPairedAt?.toISOString() ?? null };
}

/**
 * A fresh pairing code, shown once. Generating one replaces the previous
 * code, so an extension paired with the old one has to be paired again.
 */
export async function createExtensionPairing(): Promise<ActionResult<{ token: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const token = newExtensionToken();
    await db.user.update({ where: { id: user.id }, data: { extensionTokenHash: hashExtensionToken(token), extensionPairedAt: new Date() } });
    revalidatePath("/settings");
    return { token };
  });
}

export async function revokeExtensionPairing(): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.user.update({ where: { id: user.id }, data: { extensionTokenHash: null, extensionPairedAt: null } });
    revalidatePath("/settings");
    return null;
  });
}
