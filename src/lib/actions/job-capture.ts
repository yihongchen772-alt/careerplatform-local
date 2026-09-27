"use server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { normalizeJobName, normalizeJobUrl } from "@/lib/job-capture";
import { getUserAiConfig } from "@/lib/ai-providers";
import { toActionResult } from "@/lib/action-result";
export async function captureProvider() {
  return toActionResult(async () => {
    const user = await requireUser(); const config = await getUserAiConfig(user.id);
    return config ? { provider: config.provider, endpoint: config.baseUrl ? new URL(config.baseUrl).host : null } : null;
  });
}
export async function findDuplicatePositions(input: { companyName: string; title: string; jdUrl?: string }) {
  const user = await requireUser();
  const url = normalizeJobUrl(input.jdUrl), company = normalizeJobName(input.companyName), title = normalizeJobName(input.title);
  const positions = await db.position.findMany({ where: { userId: user.id }, select: { id: true, title: true, jdUrl: true, company: { select: { name: true, aliases: { select: { alias: true } } } } } });
  return positions.filter((p) => (url && normalizeJobUrl(p.jdUrl) === url) || (title && normalizeJobName(p.title) === title && [p.company.name, ...p.company.aliases.map((a) => a.alias)].some((name) => normalizeJobName(name) === company))).map((p) => ({ id: p.id, title: p.title, companyName: p.company.name }));
}
