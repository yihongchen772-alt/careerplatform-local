"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { resolveCompanyId } from "@/lib/company-resolver";
import {
  readReferralVault,
  referralCodeEntrySchema,
  type ReferralCodeEntry,
} from "@/lib/referral-vault";

async function writeReferralVault(userId: string, next: ReferralCodeEntry[]) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { applicationProfile: true } });
  const base =
    user?.applicationProfile && typeof user.applicationProfile === "object" && !Array.isArray(user.applicationProfile)
      ? ({ ...(user.applicationProfile as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  base.referralCodes = next.slice(0, 200);
  await db.user.update({
    where: { id: userId },
    data: { applicationProfile: base as Prisma.InputJsonValue },
  });
}

export async function saveReferralCode(input: {
  id?: string;
  company: string;
  code: string;
  url?: string;
  referrer?: string;
  note?: string;
  expiresAt?: string;
}): Promise<ActionResult<ReferralCodeEntry[]>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const company = input.company.trim();
    const code = input.code.trim();
    if (!company || !code) throw new UserFacingError("请填写公司名称和内推码");

    const row = await db.user.findUnique({ where: { id: user.id }, select: { applicationProfile: true } });
    const current = readReferralVault(row?.applicationProfile);
    const entry = referralCodeEntrySchema.parse({
      id: input.id?.trim() || randomUUID(),
      company,
      code,
      url: input.url?.trim() || undefined,
      referrer: input.referrer?.trim() || undefined,
      note: input.note?.trim() || undefined,
      expiresAt: input.expiresAt?.trim() || undefined,
      createdAt: new Date().toISOString(),
    });

    const filtered = current.filter(
      (item) => item.id !== entry.id && !(item.company.toLowerCase() === company.toLowerCase() && item.code.toLowerCase() === code.toLowerCase())
    );
    const next = [entry, ...filtered].slice(0, 200);
    await writeReferralVault(user.id, next);
    revalidatePath("/contacts");
    revalidatePath("/browser");
    return next;
  });
}

export async function deleteReferralCode(id: string): Promise<ActionResult<ReferralCodeEntry[]>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const row = await db.user.findUnique({ where: { id: user.id }, select: { applicationProfile: true } });
    const current = readReferralVault(row?.applicationProfile);
    const next = current.filter((item) => item.id !== id);
    await writeReferralVault(user.id, next);
    revalidatePath("/contacts");
    revalidatePath("/browser");
    return next;
  });
}

export async function importReferralPostToVaultAndPool(input: {
  company: string;
  code?: string;
  url?: string;
  referrer?: string;
  roles?: string[];
  cities?: string[];
  deadline?: string;
  note?: string;
  addToPool?: boolean;
}): Promise<ActionResult<{ codes: ReferralCodeEntry[]; addedPositions: number }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const company = input.company.trim();
    if (!company) throw new UserFacingError("未能识别公司名，请先补全公司名称");

    let codes: ReferralCodeEntry[];
    if (input.code?.trim()) {
      const saved = await saveReferralCode({
        company,
        code: input.code.trim(),
        url: input.url,
        referrer: input.referrer,
        note: input.note,
        expiresAt: input.deadline,
      });
      if (!saved.ok) throw new UserFacingError(saved.message);
      codes = saved.data;
    } else {
      const row = await db.user.findUnique({ where: { id: user.id }, select: { applicationProfile: true } });
      codes = readReferralVault(row?.applicationProfile);
    }

    let addedPositions = 0;
    if (input.addToPool) {
      const companyId = await resolveCompanyId(company, { addedByUserId: user.id });
      const safeUrl = input.url?.trim() && /^https?:\/\//i.test(input.url.trim()) ? input.url.trim() : null;
      const roles = (input.roles ?? []).map((r) => r.trim()).filter(Boolean).slice(0, 5);
      const titles = roles.length ? roles : ["校招/内推岗位"];
      const location = (input.cities ?? []).filter(Boolean).join("、") || null;
      const deadlineDate = input.deadline && /^\d{4}-\d{2}-\d{2}$/.test(input.deadline)
        ? new Date(`${input.deadline}T00:00:00.000Z`)
        : null;
      const jdText = [
        input.code ? `内推码：${input.code}` : null,
        input.referrer ? `内推人：${input.referrer}` : null,
        input.note ? `内推原文：\n${input.note}` : null,
      ].filter(Boolean).join("\n");

      for (const title of titles) {
        const exists = await db.position.findFirst({
          where: { userId: user.id, companyId, title },
          select: { id: true },
        });
        if (exists) continue;
        await db.position.create({
          data: {
            userId: user.id,
            companyId,
            title: title.slice(0, 120),
            location,
            jdUrl: safeUrl,
            jdText: jdText || null,
            deadline: deadlineDate,
            source: input.code ? `内推(${input.code})` : "群聊内推",
            status: "PLANNED",
          },
        });
        addedPositions++;
      }
      if (addedPositions > 0) revalidatePath("/pool");
    }

    return { codes, addedPositions };
  });
}
