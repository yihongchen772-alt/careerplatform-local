"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { aiSettingsSchema, updateProfileSchema } from "@/lib/validation";

export async function updateProfile(input: z.infer<typeof updateProfileSchema>) {
  const user = await requireUser();
  const data = updateProfileSchema.parse(input);

  await db.user.update({
    where: { id: user.id },
    data: {
      name: data.name,
      school: data.school,
      targetTrack: data.targetTrack,
      graduationYear: data.graduationYear,
      skills: data.skills,
      preferredCities: data.preferredCities,
      expectedSalaryMin: data.expectedSalaryMin,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/pool");
}

export async function updateAiSettings(input: z.infer<typeof aiSettingsSchema>) {
  const user = await requireUser();
  const data = aiSettingsSchema.parse(input);

  await db.user.update({
    where: { id: user.id },
    data: {
      aiProvider: data.provider,
      // Never store the plaintext key — only the encrypted form ever hits the DB.
      aiApiKeyEncrypted: encryptSecret(data.apiKey),
      aiModel: data.model || null,
    },
  });

  revalidatePath("/settings");
}

export async function clearAiSettings() {
  const user = await requireUser();
  await db.user.update({
    where: { id: user.id },
    data: { aiProvider: null, aiApiKeyEncrypted: null, aiModel: null },
  });
  revalidatePath("/settings");
}
