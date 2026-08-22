import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { UserFacingError } from "@/lib/action-result";

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};

export async function getUserMailConfig(userId: string): Promise<MailConfig | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      smtpHost: true,
      smtpPort: true,
      smtpUser: true,
      smtpPasswordEncrypted: true,
      smtpFrom: true,
    },
  });
  if (!user?.smtpHost || !user.smtpPort || !user.smtpUser || !user.smtpPasswordEncrypted) {
    return null;
  }
  return {
    host: user.smtpHost,
    port: user.smtpPort,
    user: user.smtpUser,
    password: decryptSecret(user.smtpPasswordEncrypted),
    from: user.smtpFrom || user.smtpUser,
  };
}

export async function sendMail(
  config: MailConfig,
  { to, subject, html }: { to: string; subject: string; html: string }
) {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is always implicit TLS; everything else (587, 25) starts plain and
    // upgrades via STARTTLS — getting this backwards is the #1 reason SMTP
    // "just hangs" instead of giving a clear error.
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
  });

  try {
    await transporter.sendMail({ from: config.from, to, subject, html });
  } catch (err) {
    console.error("[mailer]", err);
    throw new UserFacingError(
      "邮件发送失败，检查一下邮箱地址、授权码和 SMTP 端口是不是填对了"
    );
  }
}
