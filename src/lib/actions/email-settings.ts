"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { encryptSecret } from "@/lib/crypto";
import { getUserMailConfig, sendMail } from "@/lib/mailer";
import { emailSettingsSchema } from "@/lib/validation";
import { toActionResult, type ActionResult } from "@/lib/action-result";

export async function updateEmailSettings(input: z.infer<typeof emailSettingsSchema>) {
  const user = await requireUser();
  const data = emailSettingsSchema.parse(input);

  await db.user.update({
    where: { id: user.id },
    data: {
      smtpHost: data.host,
      smtpPort: data.port,
      smtpUser: data.user,
      // Never store the plaintext password — only the encrypted form ever hits the DB.
      smtpPasswordEncrypted: encryptSecret(data.password),
      smtpFrom: data.from || data.user,
    },
  });

  revalidatePath("/settings");
}

export async function clearEmailSettings() {
  const user = await requireUser();
  await db.user.update({
    where: { id: user.id },
    data: {
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpPasswordEncrypted: null,
      smtpFrom: null,
    },
  });
  revalidatePath("/settings");
}

export async function sendTestEmail(): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const config = await getUserMailConfig(user.id);
    if (!config) throw new Error("先保存邮箱设置");

    await sendMail(config, {
      to: config.user,
      subject: "秋招追踪 · 测试邮件",
      html: "<p>这是一封测试邮件——收到就说明邮箱配置对了。</p>",
    });
    return null;
  });
}
