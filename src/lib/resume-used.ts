/**
 * Which 简历版本 went out with a 网申: the file the applicant put on the page
 * (picked, dropped, or uploaded by 一键填写), matched against the versions by
 * the stored file itself (same name or same size) or by name. Plain module:
 * the server action and the tests use it.
 */

export type ResumeUpload = {
  by: "autofill" | "page";
  at: number;
  /** 一键填写: the version it uploaded. */
  resumeVersionId?: string;
  /** Picked or dropped on the page: what the browser saw. */
  name?: string;
  size?: number;
  /** The page it happened on, to keep another company's upload in the same tab out of it. */
  url?: string;
};

export type VersionForMatch = { id: string; name: string; storedName: string | null; size: number | null };

/** "张三-数据分析 (2).pdf" → "张三数据分析": no extension, copy marks, separators or case. */
export function normalizeFileName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\.(pdf|docx?|png|jpe?g)$/i, "")
    .replace(/[（(]\s*\d+\s*[)）]$/, "")
    .replace(/副本|copy|最终版|最新版|final/gi, "")
    .replace(/[\s_\-—–·・|｜,，.。、()（）[\]【】]+/g, "")
    .toLowerCase();
}

/** A version's name as a file name would carry it: 「定制·公司·岗位」 → "公司岗位". */
function versionKey(name: string): string {
  return normalizeFileName(name.replace(/^定制\s*[·・]\s*/, ""));
}

export type UploadMatch = { id: string; how: "file" | "size" | "name" };

/**
 * The version a picked file is: the very file the App stores (its name or its
 * size), else the version whose name the file name carries — the longest one
 * wins, so 「华为终端」 beats 「华为」.
 */
export function matchUpload(upload: { name?: string; size?: number }, versions: VersionForMatch[]): UploadMatch | null {
  const name = upload.name ?? "";
  const byFile = versions.find((v) => v.storedName && name === v.storedName);
  if (byFile) return { id: byFile.id, how: "file" };
  if (upload.size && upload.size > 0) {
    const sameSize = versions.filter((v) => v.size === upload.size);
    if (sameSize.length === 1) return { id: sameSize[0].id, how: "size" };
  }
  const key = normalizeFileName(name);
  if (key.length < 2) return null;
  const named = versions
    .map((v) => ({ v, k: versionKey(v.name) }))
    .filter(({ k }) => k.length >= 2 && (key.includes(k) || (k.length >= 4 && k.includes(key))))
    .sort((a, b) => b.k.length - a.k.length);
  if (!named.length || (named.length > 1 && named[0].k.length === named[1].k.length)) return null;
  return { id: named[0].v.id, how: "name" };
}

export type ResumeGuess = { resumeVersionId: string | null; reason: string; uploadedName?: string };

/** The newest upload on this application's pages decides; then what 一键填写 used; then a version made for this job. */
export function pickResumeUsed(input: {
  uploads: ResumeUpload[];
  versions: VersionForMatch[];
  fillResumeId?: string | null;
  tailoredForJob?: { id: string; name: string } | null;
}): ResumeGuess {
  const known = new Set(input.versions.map((v) => v.id));
  const nameOf = (id: string) => input.versions.find((v) => v.id === id)?.name ?? "";
  const latest = [...input.uploads].sort((a, b) => b.at - a.at)[0];
  if (latest?.by === "autofill" && latest.resumeVersionId && known.has(latest.resumeVersionId)) {
    return { resumeVersionId: latest.resumeVersionId, reason: `一键填写上传的是「${nameOf(latest.resumeVersionId)}」` };
  }
  if (latest?.by === "page" && latest.name) {
    const match = matchUpload(latest, input.versions);
    if (match) return { resumeVersionId: match.id, reason: `这页上传的「${latest.name}」就是「${nameOf(match.id)}」`, uploadedName: latest.name };
    return { resumeVersionId: null, reason: `这页上传的是「${latest.name}」，认不出是哪个简历版本，请选一下`, uploadedName: latest.name };
  }
  if (input.fillResumeId && known.has(input.fillResumeId)) {
    return { resumeVersionId: input.fillResumeId, reason: `一键填写用的是「${nameOf(input.fillResumeId)}」` };
  }
  if (input.tailoredForJob && known.has(input.tailoredForJob.id)) {
    return { resumeVersionId: input.tailoredForJob.id, reason: `为这个岗位定制的「${input.tailoredForJob.name}」` };
  }
  return { resumeVersionId: null, reason: "" };
}

/**
 * The file name a site (and so HR) sees for an uploaded resume: 「张三-简历.pdf」.
 * Never the App's stored hex name, nor the version's own label (「定制·…」 is
 * the applicant's note, not something to send).
 */
export function resumeUploadName(userName: string | null | undefined, ext: string): string {
  const name = (userName ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, "").slice(0, 20);
  return `${name || "个人"}-简历${/^\.[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : ".pdf"}`;
}
