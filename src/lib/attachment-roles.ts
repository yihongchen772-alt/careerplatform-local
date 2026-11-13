import path from "path";

export type AttachmentRole =
  | "photo"
  | "transcript"
  | "language"
  | "portfolio"
  | "enrollment"
  | "certificate";

export const ATTACHMENT_ROLE_META: Record<
  AttachmentRole,
  { category: string; label: string; uploadSuffix: string; hint: string }
> = {
  photo: {
    category: "证件照",
    label: "证件照 / 一寸照",
    uploadSuffix: "证件照",
    hint: "自动识别网页中的证件照 / 一寸照 / 个人照片上传框",
  },
  transcript: {
    category: "成绩单",
    label: "成绩单",
    uploadSuffix: "成绩单",
    hint: "自动识别成绩单 / 成绩证明上传框",
  },
  language: {
    category: "英语证书",
    label: "英语 / 四六级证书",
    uploadSuffix: "英语证书",
    hint: "自动识别 CET-4/6、托福、雅思等外语证明上传框",
  },
  portfolio: {
    category: "作品集",
    label: "作品集",
    uploadSuffix: "作品集",
    hint: "自动识别作品集 / 项目附件上传框",
  },
  enrollment: {
    category: "在读证明",
    label: "在读 / 学籍证明",
    uploadSuffix: "在读证明",
    hint: "自动识别学信网 / 在读证明上传框",
  },
  certificate: {
    category: "证书",
    label: "获奖 / 资格证书",
    uploadSuffix: "证书证明",
    hint: "自动识别获奖证书 / 荣誉 / 其他证明材料上传框",
  },
};

export const LIBRARY_CATEGORIES = [
  "证件照",
  "成绩单",
  "英语证书",
  "作品集",
  "在读证明",
  "证书",
  "笔试资料",
  "面试资料",
  "其他",
] as const;

export const AUTOFILL_LIBRARY_CATEGORIES = new Set<string>(
  Object.values(ATTACHMENT_ROLE_META).map((m) => m.category)
);

const CATEGORY_TO_ROLE = new Map<string, AttachmentRole>(
  Object.entries(ATTACHMENT_ROLE_META).map(([role, meta]) => [meta.category, role as AttachmentRole])
);

export function inferAttachmentRole(
  category: string | null | undefined,
  name: string
): AttachmentRole | null {
  const lower = (name || "").toLowerCase();
  if (category === "笔试资料" || category === "面试资料") return null;

  const direct = category ? CATEGORY_TO_ROLE.get(category) : undefined;
  if (direct && direct !== "certificate") return direct;

  if (/证件照|一寸照|二寸照|免冠照|个人照片|photo|avatar|headshot|portrait/i.test(lower)) {
    return "photo";
  }
  if (/四六级|四级|六级|cet-?[46]|雅思|ielts|托福|toefl|英语/i.test(lower)) return "language";
  if (/成绩单|成绩证明|transcript/i.test(lower)) return "transcript";
  if (/在读证明|学籍证明|学籍认证|enrollment/i.test(lower)) return "enrollment";
  if (/作品集|portfolio/i.test(lower)) return "portfolio";

  if (direct === "certificate") return "certificate";
  return null;
}

export function friendlyAttachmentUploadName(
  userName: string | null | undefined,
  role: AttachmentRole,
  rawExt: string
): string {
  const trimmed = (userName ?? "").trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "");
  const cleanName = trimmed && trimmed !== "我" ? trimmed : "";
  const ext = rawExt.startsWith(".") ? rawExt.toLowerCase() : `.${rawExt.toLowerCase()}`;
  const suffix = ATTACHMENT_ROLE_META[role]?.uploadSuffix || "证明附件";
  const resolvedExt = ext && ext !== "." ? ext : role === "photo" ? ".jpg" : ".pdf";
  return `${cleanName ? `${cleanName}-` : ""}${suffix}${resolvedExt}`;
}

export type ResolvedAttachmentItem = {
  id: string;
  role: AttachmentRole;
  category: string;
  name: string;
  uploadName: string;
  url: string;
  ext: string;
};

export function resolveAutofillAttachments(
  rows: { id: string; name: string; url: string; category: string | null; createdAt: Date }[],
  userName: string | null | undefined
): ResolvedAttachmentItem[] {
  // Newest matching standalone library file wins per role; application-only
  // attachments (category === null) are excluded so old company-specific files
  // never get reused unintentionally.
  const sorted = [...rows]
    .filter((row) => !!row.category && row.url.startsWith("/api/files/"))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const byRole = new Map<AttachmentRole, ResolvedAttachmentItem>();
  for (const row of sorted) {
    const role = inferAttachmentRole(row.category, row.name);
    if (!role || byRole.has(role)) continue;
    const ext = path.extname(row.url) || path.extname(row.name) || (role === "photo" ? ".jpg" : ".pdf");
    byRole.set(role, {
      id: row.id,
      role,
      category: row.category!,
      name: row.name,
      uploadName: friendlyAttachmentUploadName(userName, role, ext),
      url: row.url,
      ext,
    });
  }
  return [...byRole.values()];
}
