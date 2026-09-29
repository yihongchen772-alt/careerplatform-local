import { z } from "zod";

// Plain module: the schema the AI fills for 定制简历, and the one HTML template
// used for the in-app preview, the PDF export and the Word export alike — so
// what the applicant edits is exactly what gets exported.

const entrySchema = z.object({
  title: z.string().trim().max(120).default(""),
  subtitle: z.string().trim().max(120).default(""),
  start: z.string().trim().max(20).default(""),
  end: z.string().trim().max(20).default(""),
  bullets: z.array(z.string().trim().max(400)).max(8).default([]),
});

export const tailoredResumeSchema = z.object({
  /** 求职意向, e.g. "数据分析实习生". */
  headline: z.string().trim().max(60).default(""),
  /** 2–3 sentences of 个人优势 aimed at this JD. */
  summary: z.string().trim().max(600).default(""),
  experiences: z.array(entrySchema).max(8).default([]),
  projects: z.array(entrySchema).max(8).default([]),
  skills: z.array(z.string().trim().max(120)).max(12).default([]),
  awards: z.array(z.string().trim().max(160)).max(10).default([]),
});

export type TailoredResume = z.infer<typeof tailoredResumeSchema>;
export type TailoredContact = { name: string; phone: string; email: string; city: string };
export type TailoredEducation = { school: string; major: string; degree: string; gpa: string; start: string; end: string };

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// One date style throughout: 网申资料 stores 2025-08, the AI writes 2025.08.
function formatMonth(value: string) {
  const m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/.exec(value.trim());
  return m ? `${m[1]}.${m[2].padStart(2, "0")}` : value.trim();
}

function span(start: string, end: string) {
  return [start, end].filter(Boolean).map(formatMonth).join(" – ");
}

export const TAILORED_RESUME_CSS = `
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  html { background: #fff; }
  body { margin: 0 auto; max-width: 180mm; color: #1f2328; font: 10.5pt/1.55 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
  h1 { margin: 0; font-size: 20pt; letter-spacing: 0.02em; }
  .contact { margin-top: 2pt; color: #57606a; font-size: 9.5pt; }
  .headline { margin-top: 4pt; font-weight: 600; color: #3b3fb6; }
  h2 { margin: 12pt 0 5pt; padding-bottom: 2pt; border-bottom: 1.2pt solid #3b3fb6; color: #3b3fb6; font-size: 11.5pt; }
  .entry { margin-bottom: 6pt; break-inside: avoid; }
  .row { display: flex; justify-content: space-between; gap: 8pt; }
  .row b { font-weight: 600; }
  .muted { color: #57606a; white-space: nowrap; }
  ul { margin: 2pt 0 0; padding-left: 14pt; }
  li { margin: 1pt 0; }
  p { margin: 0; }
`;

/** The resume body (inside <body>), every value escaped. */
export function renderTailoredResumeBody(doc: TailoredResume, contact: TailoredContact, education: TailoredEducation[]): string {
  const entries = (items: TailoredResume["experiences"]) =>
    items
      .map((item) => `<div class="entry"><div class="row"><span><b>${esc(item.title)}</b>${item.subtitle ? ` · ${esc(item.subtitle)}` : ""}</span><span class="muted">${esc(span(item.start, item.end))}</span></div>${item.bullets.length ? `<ul>${item.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}</div>`)
      .join("");
  const parts = [
    `<h1>${esc(contact.name || "姓名")}</h1>`,
    `<p class="contact">${[contact.phone, contact.email, contact.city].filter(Boolean).map(esc).join(" ｜ ")}</p>`,
    doc.headline ? `<p class="headline">求职意向：${esc(doc.headline)}</p>` : "",
    doc.summary ? `<h2>个人优势</h2><p>${esc(doc.summary)}</p>` : "",
    education.length
      ? `<h2>教育经历</h2>${education
          .map((e) => `<div class="entry"><div class="row"><span><b>${esc(e.school)}</b>${[e.major, e.degree].filter(Boolean).length ? ` · ${[e.major, e.degree].filter(Boolean).map(esc).join(" · ")}` : ""}</span><span class="muted">${esc(span(e.start, e.end))}</span></div>${e.gpa ? `<p>GPA：${esc(e.gpa)}</p>` : ""}</div>`)
          .join("")}`
      : "",
    doc.experiences.length ? `<h2>实习 / 工作经历</h2>${entries(doc.experiences)}` : "",
    doc.projects.length ? `<h2>项目经历</h2>${entries(doc.projects)}` : "",
    doc.skills.length ? `<h2>专业技能</h2><ul>${doc.skills.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "",
    doc.awards.length ? `<h2>荣誉与证书</h2><ul>${doc.awards.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "",
  ];
  return parts.filter(Boolean).join("\n");
}

/** A complete standalone page around a body — what gets printed to PDF. */
export function wrapTailoredResumeHtml(body: string, title: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${TAILORED_RESUME_CSS}</style></head><body>${body}</body></html>`;
}

/** The same page as a Word-openable .doc (Word and WPS both read this HTML flavour). */
export function wrapTailoredResumeWord(body: string, title: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>${TAILORED_RESUME_CSS.replace(/display: flex;[^;]*;/, "")}</style></head><body>${body}</body></html>`;
}

/**
 * Only the markup the template itself produces survives an edit round-trip:
 * scripts, event handlers, links and embedded media are stripped, so a saved
 * or exported resume can't carry anything active even if pasted content
 * slipped past the editor's plain-text paste.
 */
export function sanitizeResumeBody(html: string): string {
  return html
    .slice(0, 300000)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|img|svg|video|audio|form|input|button|textarea|select)\b[\s\S]*?(?:<\/\s*\1\s*>|\/?>)/gi, "")
    .replace(/\s(on\w+|href|src|srcset|action|formaction|style|contenteditable)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}
