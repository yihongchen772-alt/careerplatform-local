import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const { error } = await resend.emails.send({
    from: `秋招追踪 <${FROM}>`,
    to,
    subject: "重置你的密码",
    html: `
      <p>点击下面的链接重置密码，链接 1 小时内有效：</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>如果不是你本人操作，忽略这封邮件即可。</p>
    `,
  });
  if (error) throw new Error(error.message);
}

export async function sendReminderDigestEmail(
  to: string,
  data: {
    stale: { companyName: string; title: string; daysStale: number }[];
    upcoming: { companyName: string; title: string; daysLeft: number }[];
  }
) {
  const staleRows = data.stale
    .map(
      (s) =>
        `<li>${s.companyName} · ${s.title} — 已 ${s.daysStale} 天没更新进展，该催一下了</li>`
    )
    .join("");
  const upcomingRows = data.upcoming
    .map(
      (u) =>
        `<li>${u.companyName} · ${u.title} — 还有 ${u.daysLeft} 天截止投递</li>`
    )
    .join("");

  const { error } = await resend.emails.send({
    from: `秋招追踪 <${FROM}>`,
    to,
    subject: "秋招追踪：今天有几件事要看一下",
    html: `
      ${data.stale.length > 0 ? `<h3>停滞投递</h3><ul>${staleRows}</ul>` : ""}
      ${data.upcoming.length > 0 ? `<h3>即将截止的候选岗位</h3><ul>${upcomingRows}</ul>` : ""}
      <p><a href="${process.env.NEXTAUTH_URL ?? ""}/dashboard">打开秋招追踪查看详情</a></p>
    `,
  });
  if (error) throw new Error(error.message);
}
