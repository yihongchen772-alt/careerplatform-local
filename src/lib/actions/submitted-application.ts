"use server";
import { z } from "zod";
import { lstat, readFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { resolveCompanyId } from "@/lib/company-resolver";
import { localPathForStoredUrl, saveLocalFile, mimeTypeForExtension, deleteLocalFileByUrl } from "@/lib/local-storage";
import { resolveProfileVariant, parseApplicationProfile } from "@/lib/application-profile";
import { cityFromJobText, cityFromSubmission, parseCities } from "@/lib/application-city";
import { submissionSnapshotSchema, safeSubmissionFields } from "@/lib/submission-package";
import { deleteApplication } from "@/lib/actions/applications";
import { revalidatePath } from "next/cache";
const schema = z.object({ companyName: z.string().trim().min(1).max(120), title: z.string().trim().min(1).max(200), appliedDate: z.coerce.date(), applyUrl: z.string().url().max(16384).refine((v) => /^https?:\/\//i.test(v)), source: z.string().max(200).optional(), positionId: z.string().max(100).optional(), resumeVersionId: z.string().max(100).optional(), snapshot: submissionSnapshotSchema.optional(), city: z.string().trim().max(40).optional(),
  /** The job description page the tab showed before the form (browser-view.js jdPage). */
  jd: z.object({ url: z.string().max(2000).optional(), text: z.string().max(8000) }).optional(),
  /** Recorded on its own, not by the applicant: a job already on record is left for them to decide. */
  auto: z.boolean().optional() });
export async function recordSubmittedApplication(input: z.input<typeof schema>) {
  const user = await requireUser(); const data = schema.parse(input);
  const position = data.positionId ? await db.position.findFirst({ where: { id: data.positionId, userId: user.id }, include: { company: true } }) : null;
  if (data.positionId && !position) throw new Error("关联岗位不存在");
  if (position && (position.company.name !== data.companyName || position.title !== data.title)) throw new Error("公司或职位与关联岗位不一致，请重新核对");
  // The 候选岗位 and 简历 the applicant confirms win over what the tab was filled with:
  // they may well have switched job or uploaded another file by hand.
  // The city: what the applicant confirmed, else what the form itself asked (应聘城市…) when the 岗位 has no location.
  // Then the JD page the tab showed (a 「工作地点：上海」 line) — the one-click path has no city box.
  const city = data.city || (position && parseCities(position.location).length ? "" : cityFromSubmission(data.snapshot?.fields ?? []).join("、") || (data.jd?.text ? cityFromJobText(data.jd.text).join("、") : "")) || null;
  const companyId = position?.companyId || await resolveCompanyId(data.companyName, { aiUserId: user.id });
  if (data.auto && await db.application.findFirst({ where: { userId: user.id, companyId, title: data.title }, select: { id: true } })) return { duplicate: true as const };
  const resume = data.resumeVersionId ? await db.resumeVersion.findFirst({ where: { id: data.resumeVersionId, userId: user.id } }) : null;
  if (data.resumeVersionId && !resume) throw new Error("简历不存在");
  const { profile, variant } = resolveProfileVariant(parseApplicationProfile(user.applicationProfile), data.snapshot?.variantId, data.resumeVersionId);
  let copy: { url: string; filename: string } | null = null;
  try {
    if (data.snapshot && resume?.fileUrl) {
      const file = localPathForStoredUrl(resume.fileUrl); if (!file) throw new Error("简历没有本地文件，无法保存材料包");
      const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 50 * 1024 * 1024) throw new Error("简历文件不可归档或超过 50MB");
      copy = await saveLocalFile(await readFile(file), mimeTypeForExtension(path.extname(file)) || "application/pdf");
    }
    const result = await db.$transaction(async (tx) => {
      const duplicate = await tx.application.findFirst({ where: { userId: user.id, companyId, title: data.title, applyUrl: data.applyUrl } });
      if (duplicate) throw new Error("此岗位和页面已经记录过投递，请到投递详情核对");
      const portals = await tx.applicationPortal.findMany({ where: { companyId }, take: 2 });
      // A job from outside the pool whose JD was read off its page is kept as a 岗位, already
      // 已投递: 模拟面试, 面试准备, 简历深挖 and 小欧 all work from a 岗位's JD.
      const jdRead = data.jd?.text?.trim() || "";
      let kept: { id: string; created: boolean } | null = position ? { id: position.id, created: false } : null;
      if (!position && jdRead) {
        const same = await tx.position.findFirst({ where: { userId: user.id, companyId, title: data.title }, select: { id: true, jdText: true, jdUrl: true } });
        if (same) {
          kept = { id: same.id, created: false };
          if (!same.jdText) await tx.position.update({ where: { id: same.id }, data: { jdText: jdRead, ...(same.jdUrl || !data.jd?.url ? {} : { jdUrl: data.jd.url }) } });
        } else {
          const made = await tx.position.create({ data: { userId: user.id, companyId, title: data.title, jdText: jdRead, jdUrl: data.jd?.url, source: data.source, location: city ?? undefined, status: "APPLIED" }, select: { id: true } });
          kept = { id: made.id, created: true };
        }
      }
      // The JD as it reads right now, frozen with the record: the 岗位 may be edited or deleted later.
      const jdFrozen = (position?.jdText?.trim() || jdRead || "") || null;
      const app = await tx.application.create({ data: { jdSnapshot: jdFrozen, jdSnapshotUrl: jdFrozen ? (data.jd?.url || position?.jdUrl || null) : null, userId: user.id, companyId, positionId: kept?.id, title: data.title, appliedDate: data.appliedDate, currentStageDate: data.appliedDate, applyUrl: data.applyUrl, resumeVersionId: resume?.id, portalId: portals.length === 1 ? portals[0].id : null, source: data.source || position?.source, city, currentStage: "APPLIED" } });
      let attachmentId: string | null = null;
      if (copy) { const attachment = await tx.attachment.create({ data: { userId: user.id, applicationId: app.id, url: copy.url, name: `投递时简历 · ${resume!.name}` } }); attachmentId = attachment.id; }
      const jd = position?.jdText || jdRead;
      // A 候选岗位 saved without its JD gets the one read off the job page.
      if (position && !position.jdText && data.jd?.text?.trim()) await tx.position.update({ where: { id: position.id }, data: { jdText: data.jd.text.trim(), ...(position.jdUrl || !data.jd.url ? {} : { jdUrl: data.jd.url }) } });
      if (data.snapshot) await tx.application.update({ where: { id: app.id }, data: { submissionPackage: { confirmedAt: new Date().toISOString(), pageUrl: data.snapshot.url, company: data.companyName, title: data.title, jd, profile: { name: user.name, contactEmail: user.contactEmail, phone: user.phone, ...profile }, variant: variant?.name || "默认资料", resumeName: resume?.name || "未使用简历", resumeAttachmentId: attachmentId, fields: safeSubmissionFields(data.snapshot.fields) } } });
      await tx.stageHistory.create({ data: { applicationId: app.id, stage: "APPLIED", enteredAt: data.appliedDate } });
      if (kept && !kept.created) await tx.position.update({ where: { id: kept.id }, data: { status: "APPLIED" } });
      if (app.portalId) await tx.applicationPortal.update({ where: { id: app.portalId }, data: { contentHash: null } });
      if (position) await tx.applicationDraft.deleteMany({ where: { userId: user.id, OR: [{ contextKey: `job:v1:${position.id}` }, { contextKey: { startsWith: `job:v1:${position.id}|draft:v2:` } }] } });
      else await tx.applicationDraft.deleteMany({ where: { userId: user.id, url: { in: [data.applyUrl, ...(data.snapshot ? [data.snapshot.url] : [])] } } });
      return { id: app.id, createdPositionId: kept?.created ? kept.id : null, jdSaved: !!jdFrozen };
    });
    revalidatePath("/applications"); revalidatePath("/pool"); revalidatePath("/dashboard"); return result;
  } catch (error) { if (copy) await deleteLocalFileByUrl(copy.url); throw error; }
}

/** 撤销 on a 投递 just recorded: the record goes, and a 岗位 made only for it goes too. */
export async function undoSubmittedApplication(id: string, createdPositionId?: string | null) {
  const user = await requireUser();
  await deleteApplication(String(id ?? ""));
  if (createdPositionId) await db.position.deleteMany({ where: { id: String(createdPositionId), userId: user.id, applications: { none: {} } } });
  revalidatePath("/pool");
}
