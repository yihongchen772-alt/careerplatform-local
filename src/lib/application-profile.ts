import { z } from "zod";

// Plain module (not "use server") — schema + helpers shared by the settings
// card, the account actions, and the desktop-browser profile route.

export const educationSchema = z.object({
  school: z.string().trim().max(80).default(""),
  major: z.string().trim().max(80).default(""),
  /** 院系 / 学院, asked separately from the major on many forms. */
  department: z.string().trim().max(80).default(""),
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
  /** 所在部门, asked beside the employer on 国企 / 运营商 forms. */
  department: z.string().trim().max(80).default(""),
  start: z.string().trim().max(20).default(""),
  end: z.string().trim().max(20).default(""),
  description: z.string().trim().max(5000).default(""),
});

export const projectSchema = z.object({
  name: z.string().trim().max(120).default(""),
  role: z.string().trim().max(80).default(""),
  start: z.string().trim().max(20).default(""),
  end: z.string().trim().max(20).default(""),
  description: z.string().trim().max(5000).default(""),
  responsibilities: z.string().trim().max(5000).default(""),
});

export const awardSchema = z.object({
  name: z.string().trim().max(120).default(""),
  issuer: z.string().trim().max(120).default(""),
  level: z.string().trim().max(80).default(""),
  date: z.string().trim().max(20).default(""),
  description: z.string().trim().max(3000).default(""),
});

/** 校园经历 / 学生工作: a club, student union or class role (组织、职务、级别). */
export const campusSchema = z.object({
  name: z.string().trim().max(120).default(""),
  role: z.string().trim().max(80).default(""),
  level: z.string().trim().max(40).default(""),
  start: z.string().trim().max(20).default(""),
  end: z.string().trim().max(20).default(""),
  description: z.string().trim().max(3000).default(""),
});

/** 专业技能 / 技能特长: one skill per row (技能名称、掌握程度、类别). */
export const skillSchema = z.object({
  name: z.string().trim().max(80).default(""),
  /** 了解 / 熟悉 / 熟练 / 精通 … matched to the nearest option on the page. */
  level: z.string().trim().max(40).default(""),
  category: z.string().trim().max(40).default(""),
  description: z.string().trim().max(1000).default(""),
});

/** 语言成绩: one exam per row (CET-6 580, 雅思 7.0) — forms ask for the score on its own. */
export const languageSchema = z.object({
  /** The exam or certificate: CET-6 / 雅思 / 托福 / 日语 N2 … */
  name: z.string().trim().max(60).default(""),
  /** 语种, 英语 when left blank. */
  language: z.string().trim().max(20).default(""),
  score: z.string().trim().max(20).default(""),
  date: z.string().trim().max(20).default(""),
});

export const EXTRA_FIELDS = [
  { key: "politics", label: "政治面貌", hint: "群众 / 共青团员 / 中共党员" },
  { key: "hometown", label: "籍贯", hint: "省 市" },
  { key: "ethnicity", label: "民族", hint: "汉族" },
  { key: "english", label: "英语水平", hint: "CET-6 580 / 雅思 7.0" },
  { key: "currentCity", label: "现居城市", hint: "" },
  // English portals ask for the country of residence; blank = worked out from 现居城市.
  { key: "country", label: "所在国家 / 地区", hint: "空着按现居城市判断，如 中国 / 新加坡" },
  { key: "targetRole", label: "期望岗位", hint: "数据分析 / 产品经理" },
  // Asked on most 国企 / 银行 forms; free text, filled as typed.
  { key: "expectedSalary", label: "期望薪资", hint: "面议 / 15k-20k" },
  { key: "availableFrom", label: "最早到岗时间", hint: "2026-07 / 随时" },
  { key: "internshipDuration", label: "可实习时长", hint: "6 个月，每周 5 天" },
  { key: "wechat", label: "微信号", hint: "" },
  // Seen typed by hand on 海尔 / 外企 forms after v1.22.
  { key: "englishName", label: "英文名", hint: "Eason / Yihong Chen" },
  { key: "exchange", label: "交换 / 海外经历", hint: "无 / 2023 春 某大学交换一学期" },
  { key: "address", label: "通讯地址", hint: "省 市 区 街道" },
  // Asked on most 校招 forms and missing before (seen filled by hand on 歌尔、中国移动、51job、Moka).
  { key: "researchDirection", label: "研究方向", hint: "强化学习控制 / 机器人运动控制" },
  { key: "rank", label: "成绩排名", hint: "前 10% / 5/120" },
  { key: "acceptAdjust", label: "是否接受调剂", hint: "是 / 否" },
  { key: "courses", label: "主修课程", hint: "自动控制原理、机器人学、……", multiline: true },
  // Seen filled by hand on 腾讯、网易、歌尔、中国移动 after v1.20.
  { key: "qq", label: "QQ 号", hint: "" },
  { key: "homepage", label: "个人主页 / 作品链接", hint: "GitHub / 作品集 / 博客链接" },
  { key: "lab", label: "实验室 / 课题组", hint: "智能控制实验室" },
  { key: "hobbies", label: "兴趣爱好", hint: "篮球、摄影" },
  { key: "thesis", label: "毕业论文", hint: "题目，可加一两句简介", multiline: true },
  // Long text: most forms ask for it, and each direction wants its own version.
  { key: "selfIntro", label: "自我评价", hint: "3-5 句，突出与目标岗位相关的能力", multiline: true },
] as const;

/**
 * One fact the 网申浏览器 learned from a page the applicant filled by hand:
 * a blank 常问字段, a new 校园经历 row, or blanks of a saved row. `state` is
 * what was written (the value, or the row as JSON), so 撤销 only takes back
 * what is still exactly as learned.
 */
export const learnedEntrySchema = z.object({
  id: z.string().max(40),
  kind: z.enum(["fact", "add", "fill"]),
  ref: z.string().max(80),
  label: z.string().max(200),
  state: z.string().max(12000),
  added: z.record(z.string(), z.string().max(10000)).default({}),
  source: z.string().max(1000),
  captureKey: z.string().max(200).default(""),
  at: z.string().max(40),
  undone: z.boolean().default(false),
  /** False for what the 待核对 backlog wrote, until its notice is closed. */
  seen: z.boolean().default(true),
});
export type LearnedEntry = z.infer<typeof learnedEntrySchema>;

/**
 * 资料方案: a named alternative for a different direction (数据 vs 产品 …).
 * Education is the same person whatever the direction, so it stays shared;
 * which internships/projects to lead with and the extra fields (期望城市,
 * 英语 …) are what change, and each variant keeps its own full copy of them.
 */
export const profileVariantSchema = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1, "方案名称必填").max(30),
  /** Picking this resume in the 网申浏览器 switches to this variant. */
  resumeVersionId: z.string().trim().max(40).nullish(),
  experiences: z.array(experienceSchema).max(20).default([]),
  projects: z.array(projectSchema).max(20).default([]),
  extras: z.record(z.string(), z.string().trim().max(1000)).default({}),
});

export const applicationProfileSchema = z.object({
  education: z.array(educationSchema).max(10).default([]),
  experiences: z.array(experienceSchema).max(20).default([]),
  projects: z.array(projectSchema).max(20).default([]),
  awards: z.array(awardSchema).max(30).default([]),
  campus: z.array(campusSchema).max(20).default([]),
  skills: z.array(skillSchema).max(30).default([]),
  languages: z.array(languageSchema).max(10).default([]),
  extras: z.record(z.string(), z.string().trim().max(1000)).default({}),
  variants: z.array(profileVariantSchema).max(8).default([]),
  /** What the 网申浏览器 wrote in by itself from hand-filled pages (for 撤销). */
  learned: z.array(learnedEntrySchema).max(80).default([]),
});

export type ApplicationProfile = z.infer<typeof applicationProfileSchema>;
export type ProfileVariant = z.infer<typeof profileVariantSchema>;

/**
 * The profile a 网申 is filled from: the default one, or with a variant's
 * experiences/projects/extras swapped in. An unknown id falls back to the
 * variant linked to `resumeVersionId`, then to the default.
 */
export function resolveProfileVariant(
  profile: ApplicationProfile,
  variantId?: string | null,
  resumeVersionId?: string | null
): { profile: ApplicationProfile; variant: ProfileVariant | null } {
  const variant =
    (variantId && profile.variants.find((v) => v.id === variantId)) ||
    (!variantId && resumeVersionId && profile.variants.find((v) => v.resumeVersionId === resumeVersionId)) ||
    null;
  if (!variant) return { profile, variant: null };
  return {
    profile: { ...profile, experiences: variant.experiences, projects: variant.projects, extras: { ...profile.extras, ...variant.extras } },
    variant,
  };
}
export type EducationRow = z.infer<typeof educationSchema>;
export type ExperienceRow = z.infer<typeof experienceSchema>;
export type ProjectRow = z.infer<typeof projectSchema>;
export type AwardRow = z.infer<typeof awardSchema>;
export type CampusRow = z.infer<typeof campusSchema>;
export type SkillRow = z.infer<typeof skillSchema>;
export type LanguageRow = z.infer<typeof languageSchema>;

export const EMPTY_APPLICATION_PROFILE: ApplicationProfile = { education: [], experiences: [], projects: [], awards: [], campus: [], skills: [], languages: [], extras: {}, variants: [], learned: [] };

export function parseApplicationProfile(raw: unknown): ApplicationProfile {
  const parsed = applicationProfileSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // A bad 撤销 record must never hide (and then, on save, erase) the profile.
  if (raw && typeof raw === "object" && "learned" in raw) {
    const retry = applicationProfileSchema.safeParse({ ...raw, learned: [] });
    if (retry.success) return retry.data;
  }
  return EMPTY_APPLICATION_PROFILE;
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
    const bits = [e.school, e.department, e.major, e.degree, e.gpa && `GPA ${e.gpa}`, [e.start, e.end].filter(Boolean).join("~")].filter(Boolean);
    if (bits.length) lines.push(`教育经历${i + 1}：${bits.join(" / ")}`);
  });
  p.experiences.forEach((x, i) => {
    const bits = [x.company, x.department, x.role, [x.start, x.end].filter(Boolean).join("~")].filter(Boolean);
    if (bits.length) lines.push(`实习/工作经历${i + 1}：${bits.join(" / ")}${x.description ? `——${x.description}` : ""}`);
  });
  p.projects.forEach((project, i) => {
    const bits = [project.name, project.role, [project.start, project.end].filter(Boolean).join("~")].filter(Boolean);
    if (bits.length || project.description || project.responsibilities) {
      lines.push(`项目经历${i + 1}：${bits.join(" / ")}${project.description ? `；项目描述：${project.description}` : ""}${project.responsibilities ? `；个人职责与成果：${project.responsibilities}` : ""}`);
    }
  });
  (p.awards || []).forEach((award, i) => {
    const bits = [award.name, award.level, award.issuer, award.date, award.description].filter(Boolean);
    if (bits.length) lines.push(`获奖情况${i + 1}：${bits.join(" / ")}`);
  });
  (p.campus || []).forEach((row, i) => {
    const bits = [row.name, row.role, row.level, [row.start, row.end].filter(Boolean).join("~")].filter(Boolean);
    if (bits.length) lines.push(`校园经历${i + 1}：${bits.join(" / ")}${row.description ? `——${row.description}` : ""}`);
  });
  const skills = (p.skills || []).filter((row) => row.name).map((row) => [row.name, row.level && `（${row.level}）`].filter(Boolean).join(""));
  if (skills.length) lines.push(`专业技能：${skills.join("、")}`);
  const languages = (p.languages || []).filter((row) => row.name).map(languageLine);
  if (languages.length) lines.push(`语言成绩：${languages.join("、")}`);
  for (const f of EXTRA_FIELDS) {
    const v = p.extras[f.key];
    if (v) lines.push(`${f.label}：${v}`);
  }
  return lines.join("\n");
}

/** "CET-6 580（2023-06）" — one exam as forms and the AI read it. */
export function languageLine(row: LanguageRow): string {
  return [row.language && !/英语|english/i.test(row.language) && !row.name.includes(row.language) ? row.language : "", row.name, row.score].filter(Boolean).join(" ") + (row.date ? `（${row.date}）` : "");
}

/** What the single 英语水平 box shows when it was left blank: the English exams. */
export function englishFromLanguages(rows: LanguageRow[]): string {
  return rows.filter((row) => row.name && (!row.language || /英语|english/i.test(row.language))).map((row) => [row.name, row.score].filter(Boolean).join(" ")).join("，");
}
