"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { aiSettingsSchema } from "@/lib/validation";
import { AI_PROVIDER_OPTIONS, type AiProviderId } from "@/lib/ai-provider-labels";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

export type AiKeyOverview = {
  provider: AiProviderId;
  label: string;
  configured: boolean;
  model: string | null;
  baseUrl: string | null;
  isDefault: boolean;
};

/** One row per provider (configured or not) for the settings UI. */
export async function getAiKeysOverview(userId: string): Promise<AiKeyOverview[]> {
  const [user, keys] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { defaultAiProvider: true } }),
    db.aiKey.findMany({ where: { userId } }),
  ]);
  const byProvider = new Map(keys.map((k) => [k.provider, k]));

  return AI_PROVIDER_OPTIONS.map(({ id, label }) => {
    const key = byProvider.get(id);
    return {
      provider: id,
      label,
      configured: !!key,
      model: key?.model ?? null,
      baseUrl: key?.baseUrl ?? null,
      isDefault: user?.defaultAiProvider === id,
    };
  });
}

export async function upsertAiKey(input: z.infer<typeof aiSettingsSchema>) {
  const user = await requireUser();
  const data = aiSettingsSchema.parse(input);

  await db.aiKey.upsert({
    where: { userId_provider: { userId: user.id, provider: data.provider } },
    update: {
      // Never store the plaintext key — only the encrypted form ever hits the DB.
      apiKeyEncrypted: encryptSecret(data.apiKey),
      model: data.model || null,
      baseUrl: data.baseUrl || null,
    },
    create: {
      userId: user.id,
      provider: data.provider,
      apiKeyEncrypted: encryptSecret(data.apiKey),
      model: data.model || null,
      baseUrl: data.baseUrl || null,
    },
  });

  // First key ever configured becomes the default automatically; after that,
  // switching the default is an explicit separate action.
  const current = await db.user.findUnique({
    where: { id: user.id },
    select: { defaultAiProvider: true },
  });
  if (!current?.defaultAiProvider) {
    await db.user.update({
      where: { id: user.id },
      data: { defaultAiProvider: data.provider },
    });
  }

  revalidatePath("/settings");
}

export async function deleteAiKey(provider: AiProviderId) {
  const user = await requireUser();

  await db.aiKey.delete({
    where: { userId_provider: { userId: user.id, provider } },
  }).catch(() => {});

  const current = await db.user.findUnique({
    where: { id: user.id },
    select: { defaultAiProvider: true },
  });
  if (current?.defaultAiProvider === provider) {
    await db.user.update({
      where: { id: user.id },
      data: { defaultAiProvider: null },
    });
  }

  revalidatePath("/settings");
}

export async function setDefaultAiProvider(provider: AiProviderId): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();

    const key = await db.aiKey.findUnique({
      where: { userId_provider: { userId: user.id, provider } },
    });
    if (!key) throw new UserFacingError("请先配置这个服务商的 Key，再设为默认");

    await db.user.update({
      where: { id: user.id },
      data: { defaultAiProvider: provider },
    });

    revalidatePath("/settings");
    return null;
  });
}
