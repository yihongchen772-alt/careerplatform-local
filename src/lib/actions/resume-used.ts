"use server";

import { stat } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { localPathForStoredUrl } from "@/lib/local-storage";
import { parseDraft } from "@/lib/resume-doc";
import { pickResumeUsed, type ResumeGuess, type ResumeUpload } from "@/lib/resume-used";
import { siteKey } from "@/lib/site-key";

const loose = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const sameName = (a: string, b: string) => {
  const x = loose(a);
  const y = loose(b);
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x));
};

/**
 * 记为已投递: which 简历版本 this 网申 went out with — see resume-used.ts.
 * Never throws: no guess just means the dialog keeps its own default.
 */
export async function guessResumeUsed(input: {
  uploads?: ResumeUpload[];
  fillResumeId?: string | null;
  positionId?: string | null;
  companyName?: string;
  title?: string;
  urls?: string[];
}): Promise<ResumeGuess> {
  try {
    const user = await requireUser();
    const versions = await db.resumeVersion.findMany({ where: { userId: user.id }, select: { id: true, name: true, fileUrl: true } });
    const forMatch = await Promise.all(
      versions.map(async (v) => {
        const file = v.fileUrl ? localPathForStoredUrl(v.fileUrl) : null;
        const size = file ? await stat(file).then((s) => s.size).catch(() => null) : null;
        return { id: v.id, name: v.name, storedName: file ? path.basename(file) : null, size };
      })
    );
    // Only this application's pages count: the same tab may have sent another company's 网申 earlier.
    const urls = new Set((input.urls ?? []).filter((u) => typeof u === "string"));
    const sites = new Set([...urls].map((u) => siteKey(u) ?? hostOf(u)).filter(Boolean));
    const recent = Date.now() - 12 * 3600_000;
    const uploads: ResumeUpload[] = (Array.isArray(input.uploads) ? input.uploads : [])
      .slice(0, 10)
      .filter((u) => u && (u.by === "autofill" || u.by === "page") && Number.isFinite(u.at) && Number(u.at) > recent)
      .filter((u) => !sites.size || !u.url || sites.has(siteKey(u.url) ?? hostOf(u.url)))
      .map((u) => ({ by: u.by, at: Number(u.at), resumeVersionId: typeof u.resumeVersionId === "string" ? u.resumeVersionId : undefined, name: typeof u.name === "string" ? u.name.slice(0, 200) : undefined, size: typeof u.size === "number" ? u.size : undefined }));
    // A 定制 saved as a version for this very job: same 候选岗位, same page, or same company and title.
    const tailorings = await db.resumeTailoring.findMany({
      where: { userId: user.id, savedVersionId: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: { positionId: true, savedVersionId: true, draft: true, savedVersion: { select: { name: true } } },
    });
    const forJob = tailorings.find((row) => {
      if (input.positionId && row.positionId === input.positionId) return true;
      const target = parseDraft(row.draft)?.target;
      if (!target) return false;
      if (target.url && urls.has(target.url)) return true;
      return !!input.companyName && !!input.title && sameName(target.company, input.companyName) && sameName(target.title, input.title);
    });
    return pickResumeUsed({
      uploads,
      versions: forMatch,
      fillResumeId: input.fillResumeId ?? null,
      tailoredForJob: forJob?.savedVersionId ? { id: forJob.savedVersionId, name: forJob.savedVersion?.name ?? "" } : null,
    });
  } catch {
    return { resumeVersionId: null, reason: "" };
  }
}
