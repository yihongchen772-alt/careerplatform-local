import { z } from "zod";

// Plain module (not "use server") — schema + helpers shared by the settings
// card, the account actions, and the desktop-browser profile route.

export const educationSchema = z.object({
  school: z.string().trim().max(80).default(""),
  major: z.string().trim().max(80).default(""),
  /** 本科 / 硕士 / 博士 / 大专 … free text. */
  degree: z.string().trim().max(40).default(""),
  gpa: z.string().trim().max(40).default(""),
  /** yyyy-MM, whatever the user typed is kept; the filler normalises. */
  start: z.string().trim().max(20).default(""),
  end: z.string().trim().max(20).default(""),
});

export const experienceSchema = z.object({
  company: z.string().trim().max(80).default(""),
  role: z.string().trim().max(80).default(""),
  start: z.string().trim().max(20).default(""),
  end: z.string().trim().max(20).default(""),
  description: z.string().trim().max(1000).default(""),
});

export const projectSchema = z.object({
  name: z.string().trim().max(120).default(""),
  role: z.string().trim().max(80).default(""),
  start: z.string().trim().max(20).default(""),
  end: z.string().trim().max(20).default(""),
  description: z.string().trim().max(1500).default(""),
  responsibilities: z.string().trim().max(1500).default(""),
});

export const EXTRA_FIELDS = [
  { key: "politics", label: "政治面貌", hint: "群众 / 共青团员 / 中共党员" },
  { key: "hometown", label: "籍贯", hint: "省 市" },
  { key: "ethnicity", label: "民族", hint: "汉族" },
  { key: "english", label: "英语水平", hint: "CET-6 580 / 雅思 7.0" },
  { key: "currentCity", label: "现居城市", hint: "" },
] as const;

export const applicationProfileSchema = z.object({
  education: z.array(educationSchema).max(10).default([]),
  experiences: z.array(experienceSchema).max(20).default([]),
  projects: z.array(projectSchema).max(20).default([]),
  extras: z.record(z.string(), z.string().trim().max(200)).default({}),
});

export type ApplicationProfile = z.infer<typeof applicationProfileSchema>;
export type EducationRow = z.infer<typeof educationSchema>;
export type ExperienceRow = z.infer<typeof experienceSchema>;
export type ProjectRow = z.infer<typeof projectSchema>;

export const EMPTY_APPLICATION_PROFILE: ApplicationProfile = { education: [], experiences: [], projects: [], extras: {} };

export function parseApplicationProfile(raw: unknown): ApplicationProfile {
  const parsed = applicationProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_APPLICATION_PROFILE;
}

/** Resume extraction may add facts, but must not erase projects edited by hand. */
export function mergeProjectRows(current: ProjectRow[], extracted: ProjectRow[]): ProjectRow[] {
  const merged = current.map((project) => ({ ...project }));
  for (const project of extracted) {
    if (!Object.values(project).some(Boolean)) continue;
    const name = project.name.trim().toLowerCase();
    const index = name ? merged.findIndex((existing) => existing.name.trim().toLowerCase() === name) : -1;
    if (index === -1) {
      merged.push(project);
    } else {
      const saved = merged[index];
      merged[index] = {
        name: saved.name || project.name,
        role: saved.role || project.role,
        start: saved.start || project.start,
        end: saved.end || project.end,
        description: saved.description || project.description,
        responsibilities: saved.responsibilities || project.responsibilities,
      };
    }
  }
  return merged.slice(0, 20);
}

/** One readable block for the AI's "已知信息" — nested JSON would just become [object Object]. */
export function describeApplicationProfile(p: ApplicationProfile): string {
  const lines: string[] = [];
  p.education.forEach((e, i) => {
    const bits = [e.school, e.major, e.degree, e.gpa && `GPA ${e.gpa}`, [e.start, e.end].filter(Boolean).join("~")].filter(Boolean);
    if (bits.length) lines.push(`教育经历${i + 1}：${bits.join(" / ")}`);
  });
  p.experiences.forEach((x, i) => {
    const bits = [x.company, x.role, [x.start, x.end].filter(Boolean).join("~")].filter(Boolean);
    if (bits.length) lines.push(`实习/工作经历${i + 1}：${bits.join(" / ")}${x.description ? `——${x.description}` : ""}`);
  });
  p.projects.forEach((project, i) => {
    const bits = [project.name, project.role, [project.start, project.end].filter(Boolean).join("~")].filter(Boolean);
    if (bits.length || project.description || project.responsibilities) {
      lines.push(`项目经历${i + 1}：${bits.join(" / ")}${project.description ? `；项目描述：${project.description}` : ""}${project.responsibilities ? `；个人职责与成果：${project.responsibilities}` : ""}`);
    }
  });
  for (const f of EXTRA_FIELDS) {
    const v = p.extras[f.key];
    if (v) lines.push(`${f.label}：${v}`);
  }
  return lines.join("\n");
}
