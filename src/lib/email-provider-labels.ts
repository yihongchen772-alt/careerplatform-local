/**
 * Pure metadata, no server-only imports — safe to import from client
 * components, mirrors the pattern in ai-provider-labels.ts.
 */
export type EmailProviderId = "gmail" | "qq" | "163" | "outlook" | "custom";

export const EMAIL_PROVIDER_OPTIONS: {
  id: EmailProviderId;
  label: string;
  host: string;
  port: number;
  help: string;
}[] = [
  {
    id: "gmail",
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 465,
    help: "需要在 Google 账号安全设置里生成一个「应用专用密码」，不是你的登录密码",
  },
  {
    id: "qq",
    label: "QQ 邮箱",
    host: "smtp.qq.com",
    port: 465,
    help: "在 QQ 邮箱设置 → 账户里开启 SMTP 服务后生成的「授权码」，不是 QQ 密码",
  },
  {
    id: "163",
    label: "163 邮箱",
    host: "smtp.163.com",
    port: 465,
    help: "在 163 邮箱设置里开启 SMTP 服务后生成的「授权密码」，不是登录密码",
  },
  {
    id: "outlook",
    label: "Outlook / Hotmail",
    host: "smtp.office365.com",
    port: 587,
    help: "微软账号密码，如果开了两步验证需要生成应用密码",
  },
  {
    id: "custom",
    label: "自定义",
    host: "",
    port: 465,
    help: "自己填 SMTP 服务器地址和端口",
  },
];
