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

  const existing = await db.aiKey.findUnique({
    where: { userId_provider: { userId: user.id, provider: data.provider } },
  });
  if (!existing && !data.apiKey) {
    throw new UserFacingError("请填写 API Key");
  }
  // Doubao has no universal default model (see AI_PROVIDER_OPTIONS — its
  // "model" is actually a per-account 推理接入点 ID), so unlike every other
  // provider there's no safe fallback to leave in place: a row with no model
  // at all would make every call site quietly send the placeholder example
  // string as a real API parameter.
  if (data.provider === "doubao" && !data.model && !existing?.model) {
    throw new UserFacingError("豆包没有通用默认模型，请填你自己的推理接入点 ID");
  }

  // Explicit create/update instead of db.aiKey.upsert(): Prisma validates
  // BOTH the create and update payloads up front (it's a single query, not a
  // client-side check-then-branch), so an upsert's `create` object must have
  // every required field populated even on a save that only ever takes the
  // `update` path — which is exactly the blank-apiKey case this function
  // exists to support.
  if (existing) {
    await db.aiKey.update({
      where: { userId_provider: { userId: user.id, provider: data.provider } },
      data: {
        // A blank apiKey means "just changing the model/地址" — leave the
        // already-encrypted key alone rather than overwriting it with
        // whatever encryptSecret("") would produce.
        ...(data.apiKey ? { apiKeyEncrypted: encryptSecret(data.apiKey) } : {}),
        model: data.model || null,
        baseUrl: data.baseUrl || null,
      },
    });
  } else {
    await db.aiKey.create({
      data: {
        userId: user.id,
        provider: data.provider,
        // Never store the plaintext key — only the encrypted form ever hits
        // the DB. data.apiKey is guaranteed truthy here by the guard above.
        apiKeyEncrypted: encryptSecret(data.apiKey!),
        model: data.model || null,
        baseUrl: data.baseUrl || null,
      },
    });
  }

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
