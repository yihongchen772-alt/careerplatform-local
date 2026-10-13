import type { Prisma } from "@prisma/client";

/**
 * 「投递成功 / 简历已收到」 mail for something not recorded yet: the 投递
 * is recorded by itself (投递 made on a phone, a 内推 link, a site outside the
 * 网申浏览器), with 撤销 in the 自动更新 banner. Its first step carries
 * autoSource "email-new"; undoing that step deletes the 投递 again.
 */
export const NEW_APPLICATION_SOURCE = "email-new";

function normal(text: string): string {
  return text
    .toLowerCase()
    .replace(/（[^）]*）|\([^)]*\)|【[^】]*】|\[[^\]]*\]/g, "")
    .replace(/有限公司|有限责任公司|股份|集团|公司|校园招聘|校招|秋招|春招|20\d\d届?|届|岗位|职位|实习生?|[\s\-—_·/|,，、.:：]/g, "");
}

/** Same company: the name or one of its aliases, after dropping 有限公司 and friends. */
export function sameCompanyName(a: string, names: string[]): boolean {
  const key = normal(a);
  if (!key) return false;
  return names.some((name) => {
    const other = normal(name);
    return !!other && (other === key || (Math.min(other.length, key.length) >= 2 && (other.includes(key) || key.includes(other))));
  });
}

/** Same job: one title contains the other once 校招/2027届/brackets are dropped. */
export function sameJobTitle(a: string, b: string): boolean {
  const x = normal(a);
  const y = normal(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)));
}

export type KnownApplication = { companyNames: string[]; title: string };

/**
 * Is this 投递 already on record? With no job title in the mail, any 投递 to
 * that company counts — better to miss one than to create a duplicate.
 */
export function alreadyRecorded(company: string, title: string, known: KnownApplication[]): boolean {
  return known.some((entry) => sameCompanyName(company, entry.companyNames) && (!title.trim() || sameJobTitle(title, entry.title)));
}

export async function createApplicationFromMail(
  tx: Prisma.TransactionClient,
  input: { userId: string; companyId: string; title: string; appliedAt: Date; subject: string }
): Promise<string> {
  const portals = await tx.applicationPortal.findMany({ where: { companyId: input.companyId }, select: { id: true }, take: 2 });
  const application = await tx.application.create({
    data: {
      userId: input.userId,
      companyId: input.companyId,
      portalId: portals.length === 1 ? portals[0].id : null,
      title: input.title.slice(0, 200),
      appliedDate: input.appliedAt,
      source: "邮件自动记录",
      currentStage: "APPLIED",
      currentStageDate: input.appliedAt,
    },
    select: { id: true },
  });
  const subject = input.subject.trim().slice(0, 120) || "（无主题）";
  await tx.stageHistory.create({
    data: {
      applicationId: application.id,
      stage: "APPLIED",
      enteredAt: input.appliedAt,
      note: `从邮件自动记录：「${subject}」`,
      autoSource: NEW_APPLICATION_SOURCE,
      autoEvidence: `邮件「${subject}」`.slice(0, 300),
    },
  });
  return application.id;
}
