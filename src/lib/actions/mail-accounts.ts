"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { mailAccountSchema } from "@/lib/validation";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

export type MailAccountOverview = {
  id: string;
  label: string;
  email: string;
  imapHost: string;
  imapPort: number;
  enabled: boolean;
  lastCheckedAt: string | null;
};

export async function listMailAccounts(userId: string): Promise<MailAccountOverview[]> {
  const accounts = await db.mailAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return accounts.map((a) => ({
    id: a.id,
    label: a.label || a.email,
    email: a.email,
    imapHost: a.imapHost,
    imapPort: a.imapPort,
    enabled: a.enabled,
    lastCheckedAt: a.lastCheckedAt?.toISOString() ?? null,
  }));
}

export async function addMailAccount(
  input: z.infer<typeof mailAccountSchema>
): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const data = mailAccountSchema.parse(input);

    const existing = await db.mailAccount.findFirst({
      where: { userId: user.id, email: data.email },
    });
    if (existing) throw new UserFacingError("这个邮箱已经加过了");

    const account = await db.mailAccount.create({
      data: {
        userId: user.id,
        label: data.label || null,
        imapHost: data.imapHost,
        imapPort: data.imapPort,
        email: data.email,
        passwordEncrypted: encryptSecret(data.password),
      },
    });

    revalidatePath("/settings");
    return { id: account.id };
  });
}

export async function setMailAccountEnabled(
  id: string,
  enabled: boolean
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const updated = await db.mailAccount.updateMany({
      where: { id, userId: user.id },
      data: { enabled },
    });
    if (updated.count === 0) throw new UserFacingError("找不到这个邮箱");
    revalidatePath("/settings");
    return null;
  });
}

export async function deleteMailAccount(id: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    await db.mailAccount.deleteMany({ where: { id, userId: user.id } });
    revalidatePath("/settings");
    return null;
  });
}
