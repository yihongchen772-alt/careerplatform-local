import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchLatestEmailsForOtp, getUserScanAccounts, type InboxEmail } from "@/lib/imap";
import { pickBestOtpCandidates } from "@/lib/email-otp";
import { requireUser } from "@/lib/session";

const bodySchema = z.object({
  url: z.string().max(2000).optional(),
  companyName: z.string().max(200).optional(),
  title: z.string().max(300).optional(),
});

const ACCOUNT_TIMEOUT_MS = 8500;
type LabeledEmail = InboxEmail & { accountLabel: string };

async function fetchAccountLatest(account: Awaited<ReturnType<typeof getUserScanAccounts>>[number]): Promise<LabeledEmail[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<LabeledEmail[]>([
      fetchLatestEmailsForOtp(account, 12).then((rows) => rows.map((row) => ({ ...row, accountLabel: account.label }))),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("读取邮箱超时")), ACCOUNT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const input = parsed.success ? parsed.data : {};

  const accounts = await getUserScanAccounts(user.id);
  if (!accounts.length) {
    return NextResponse.json({
      available: false,
      reason: "还没绑定开启扫描的邮箱，去「设置 → 邮箱」添加后就能一键读取邮箱验证码",
      candidates: [],
    });
  }

  const settled = await Promise.allSettled(accounts.map((acc) => fetchAccountLatest(acc)));
  const allEmails: Array<InboxEmail & { accountLabel: string }> = [];
  let errorAccounts = 0;
  for (const res of settled) {
    if (res.status === "fulfilled") allEmails.push(...res.value);
    else errorAccounts++;
  }

  const candidates = pickBestOtpCandidates(allEmails, {
    url: input.url,
    companyName: input.companyName,
    title: input.title,
  });

  return NextResponse.json({
    available: true,
    checkedAccounts: accounts.length,
    errorAccounts,
    candidates,
  });
}
