"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserImapConfig, fetchRecentEmails, type InboxEmail } from "@/lib/imap";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

const classificationSchema = z.object({
  results: z.array(
    z.object({
      index: z.number(),
      isJobRelated: z.boolean(),
      type: z.string(),
      // .nullish(), not .nullable(): providers using the plain
      // response_format:"json_object" mode (i.e. not Gemini) can drop a key
      // entirely instead of emitting null, so a missing key must be
      // tolerated the same as an explicit null (see jd-parse.ts).
      company: z.string().nullish(),
      summary: z.string(),
    })
  ),
});

async function classifyEmails(
  emails: InboxEmail[],
  aiConfig: Awaited<ReturnType<typeof getUserAiConfig>>
) {
  const listing = emails
    .map(
      (e, i) =>
        `[${i}] 发件人：${e.from}\n主题：${e.subject}\n正文片段：${e.snippet.slice(0, 300)}`
    )
    .join("\n\n");

  const prompt = `以下是用户收件箱里最近的一批邮件，帮他判断哪些是秋招求职相关的通知（面试邀请、笔试/OA通知、offer、拒信、进度更新之类），哪些是无关邮件（推广、账单、其他工作、日常邮件等）。

邮件列表：
${listing}

对每一封邮件返回：
- index：对应上面的编号
- isJobRelated：是否是求职相关通知
- type：如果相关，简短描述类型（比如"面试邀请""笔试通知""offer""拒信""进度更新"）；不相关就填"其他"
- company：能看出来是哪家公司就填公司名，看不出来填 null
- summary：一句话中文概括这封邮件在说什么

不确定的邮件宁可判断为不相关，不要把无关邮件误判成求职通知。`;

  const raw = await callTextAi({
    config: aiConfig,
    prompt,
    thinkingBudget: 1024,
    timeoutMs: 60000,
    schema: {
      type: "OBJECT",
      properties: {
        results: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              index: { type: "NUMBER" },
              isJobRelated: { type: "BOOLEAN" },
              type: { type: "STRING" },
              company: { type: "STRING", nullable: true },
              summary: { type: "STRING" },
            },
            required: ["index", "isJobRelated", "type", "company", "summary"],
          },
        },
      },
      required: ["results"],
    },
  });

  const parsed = classificationSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");
  return parsed.data.results;
}

async function runScan(userId: string): Promise<{ found: number; scanned: number }> {
  const imapConfig = await getUserImapConfig(userId);
  if (!imapConfig) return { found: 0, scanned: 0 };

  const aiConfig = await getUserAiConfig(userId);
  if (!aiConfig) {
    throw new UserFacingError(
      "扫描收件箱需要先在「AI 设置」里配置好 API Key，用来判断邮件类型"
    );
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { lastEmailCheckAt: true },
  });
  // First-ever check looks back 3 days rather than the whole mailbox history
  // — otherwise the first scan on a long-lived inbox would classify years of
  // mail in one go.
  const since = user?.lastEmailCheckAt ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const emails = await fetchRecentEmails(imapConfig, since);
  let found = 0;

  if (emails.length > 0) {
    const classifications = await classifyEmails(emails, aiConfig);
    for (const c of classifications) {
      if (!c.isJobRelated) continue;
      const email = emails[c.index];
      if (!email) continue;
      await db.personalTask.create({
        data: {
          userId,
          title: `${c.type}${c.company ? `：${c.company}` : ""}`,
          note: `${c.summary}\n\n邮件主题：${email.subject}\n来自：${email.from}`,
        },
      });
      found += 1;
    }
  }

  await db.user.update({
    where: { id: userId },
    data: { lastEmailCheckAt: new Date() },
  });

  return { found, scanned: emails.length };
}

/** Manual trigger from settings — surfaces errors to the user. */
export async function scanInboxNow(): Promise<ActionResult<{ found: number; scanned: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const result = await runScan(user.id);
    revalidatePath("/dashboard");
    return result;
  });
}

/**
 * Called once per app launch, same as checkAndSendOnLaunch — must never
 * throw into a plain app boot, so failures are swallowed here rather than
 * surfaced.
 */
export async function scanInboxOnLaunch(userId: string): Promise<void> {
  try {
    await runScan(userId);
  } catch (err) {
    console.error("[inbox-scan] on-launch scan failed", err);
  }
}
