"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { sendPasswordResetEmail } from "@/lib/email";
import { encryptSecret } from "@/lib/crypto";
import {
  aiSettingsSchema,
  changePasswordSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from "@/lib/validation";

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

export async function changePassword(
  input: z.infer<typeof changePasswordSchema>
) {
  const user = await requireUser();
  const data = changePasswordSchema.parse(input);

  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser?.passwordHash) throw new Error("该账号未设置密码");

  const isValid = await bcrypt.compare(data.currentPassword, dbUser.passwordHash);
  if (!isValid) throw new Error("当前密码不正确");

  const passwordHash = await bcrypt.hash(data.newPassword, 10);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });
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

export async function requestPasswordReset(
  input: z.infer<typeof requestPasswordResetSchema>
) {
  const data = requestPasswordResetSchema.parse(input);

  const user = await db.user.findUnique({ where: { email: data.email } });
  // Always behave the same whether or not the account exists, so this
  // endpoint can't be used to enumerate registered emails.
  if (!user) return;

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  await db.verificationToken.deleteMany({ where: { identifier: data.email } });
  await db.verificationToken.create({
    data: { identifier: data.email, token, expires },
  });

  const resetUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  await sendPasswordResetEmail(data.email, resetUrl);
}

export async function resetPassword(input: z.infer<typeof resetPasswordSchema>) {
  const data = resetPasswordSchema.parse(input);

  const record = await db.verificationToken.findUnique({
    where: { token: data.token },
  });
  if (!record || record.expires < new Date()) {
    throw new Error("重置链接无效或已过期");
  }

  const passwordHash = await bcrypt.hash(data.newPassword, 10);
  await db.user.update({
    where: { email: record.identifier },
    data: { passwordHash },
  });

  await db.verificationToken.delete({ where: { token: data.token } });
}
