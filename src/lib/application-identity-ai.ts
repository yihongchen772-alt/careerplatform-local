import { z } from "zod";
import { callTextAi, getUserAiConfig } from "@/lib/ai-providers";
import { identityFieldsForAi, tidyIdentity } from "@/lib/application-identity";
import type { GeminiSchema } from "@/lib/gemini";

// The last resort when the browser's own reading of the pages (see
// application-identity.ts) leaves the employer or the job blank. Sent: page
// titles, addresses without their query strings, the start of the success
// page's text with the applicant's name, email, phone and ID numbers masked,
// and the form fields that name the job — no other form field.
export const identifyInputSchema = z.object({
  url: z.string().max(16384),
  title: z.string().max(300).default(""),
  text: z.string().max(4000).default(""),
  siteName: z.string().max(100).nullish(),
  history: z.array(z.object({ url: z.string().max(16384), title: z.string().max(300) })).max(15).default([]),
  fields: z.array(z.object({ label: z.string().max(200), value: z.string().max(20000) })).max(250).default([]),
  known: z.object({ companyName: z.string().max(120).default(""), title: z.string().max(200).default("") }).default({ companyName: "", title: "" }),
});
export type IdentifyInput = z.infer<typeof identifyInputSchema>;
export type AiIdentity = { companyName: string | null; title: string | null; unavailable?: boolean; failed?: boolean };

const answerSchema: GeminiSchema = {
  type: "OBJECT",
  properties: {
    companyName: { type: "STRING", nullable: true },
    title: { type: "STRING", nullable: true },
  },
  required: ["companyName", "title"],
};

function bareAddress(raw: string) {
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? `${url.host}${url.pathname}`.slice(0, 200) : "";
  } catch {
    return "";
  }
}

function masked(value: string, name: string | null | undefined) {
  let text = value
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "（邮箱）")
    .replace(/\d{17}[\dXx]/g, "（证件号）")
    .replace(/(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d(?:[\s-]?\d{4}){2}(?!\d)/g, "（手机号）");
  if (name && name.trim().length >= 2) text = text.split(name.trim()).join("（姓名）");
  return text;
}

export async function askAiForIdentity(user: { id: string; name: string | null }, input: IdentifyInput): Promise<AiIdentity> {
  const config = await getUserAiConfig(user.id);
  if (!config) return { companyName: null, title: null, unavailable: true };
  const pages = [...input.history, { url: input.url, title: input.title }]
    .slice(-10)
    .map((page, index) => `${index + 1}. ${masked(page.title, user.name) || "（无标题）"} — ${bareAddress(page.url)}`)
    .join("\n");
  const fields = identityFieldsForAi(input.fields).map((field) => `${field.label}：${field.value}`).join("\n");
  const known = [input.known.companyName && `公司是「${input.known.companyName}」`, input.known.title && `岗位是「${input.known.title}」`].filter(Boolean).join("，");
  const prompt = [
    "用户刚在企业的招聘网站上提交了一份网申。根据下面浏览器里看到的信息，判断这次投递的：",
    "1. companyName：招聘方（雇主）的公司名称，用常用简称（如「腾讯」「招商银行」）；不要写招聘系统或招聘平台（如 Moka、北森、飞书招聘、智联招聘、BOSS直聘、Workday）。",
    "2. title：投递的岗位名称，去掉届别、批次、城市、编号等修饰。",
    "只能根据下面给出的信息判断，确实看不出来的填 null，不要编造。",
    known ? `已经从页面识别出${known}，可作为参考。` : "",
    `\n这个标签页依次打开过的页面（最后一个是当前页）：\n${pages}`,
    input.siteName ? `\n网站名称：${input.siteName}` : "",
    fields ? `\n表单里和岗位有关的字段：\n${fields}` : "",
    input.text ? `\n当前页面的文字（节选）：\n${masked(input.text.slice(0, 2000), user.name)}` : "",
  ].filter(Boolean).join("\n");
  try {
    const raw = await callTextAi({ config, prompt, schema: answerSchema, thinkingBudget: 512, timeoutMs: 30000 });
    const answer = z.object({ companyName: z.unknown().optional(), title: z.unknown().optional() }).parse(raw);
    const tidy = tidyIdentity(typeof answer.companyName === "string" ? answer.companyName : "", typeof answer.title === "string" ? answer.title : "");
    return { companyName: tidy.companyName || null, title: tidy.title || null };
  } catch {
    return { companyName: null, title: null, failed: true };
  }
}
