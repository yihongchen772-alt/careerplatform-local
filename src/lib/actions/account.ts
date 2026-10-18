"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import type { Prisma } from "@prisma/client";
import { updateProfileSchema } from "@/lib/validation";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { getResumeContext } from "@/lib/resume-context";
import { callTextAi, getUserAiConfig } from "@/lib/ai-providers";
import { applicationProfileSchema, parseApplicationProfile, type ApplicationProfile } from "@/lib/application-profile";

export async function updateProfile(input: z.infer<typeof updateProfileSchema>) {
  const user = await requireUser();
  const data = updateProfileSchema.parse(input);

  await db.user.update({
    where: { id: user.id },
    data: {
      name: data.name,
      phone: data.phone,
      contactEmail: data.contactEmail,
      gender: data.gender,
      birthDate: data.birthDate,
      school: data.school,
      targetTrack: data.targetTrack,
      graduationYear: data.graduationYear,
      skills: data.skills,
      preferredCities: data.preferredCities,
      expectedSalaryMin: data.expectedSalaryMin,
    },
  });

  revalidatePath("/settings");
  revalidatePath("/pool");
}

export async function updateApplicationProfile(input: unknown): Promise<ActionResult<ApplicationProfile>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const data = applicationProfileSchema.parse(input);
    // The 撤销 records belong to the browser, which may have learned more
    // while this form was open; the stored ones are kept as they are.
    const stored = await db.user.findUnique({ where: { id: user.id }, select: { applicationProfile: true } });
    // Drop fully blank rows — an empty education row still counts as
    // "education[0]" to the keyword matcher and would fill nothing.
    const cleaned: ApplicationProfile = {
      education: data.education.filter((e) => Object.values(e).some(Boolean)),
      experiences: data.experiences.filter((x) => Object.values(x).some(Boolean)),
      projects: data.projects.filter((project) => Object.values(project).some(Boolean)),
      awards: data.awards.filter((award) => Object.values(award).some(Boolean)),
      campus: data.campus.filter((row) => Object.values(row).some(Boolean)),
      skills: data.skills.filter((row) => Object.values(row).some(Boolean)),
      languages: data.languages.filter((row) => row.name),
      extras: Object.fromEntries(Object.entries(data.extras).filter(([, v]) => v)),
      learned: parseApplicationProfile(stored?.applicationProfile).learned,
      variants: data.variants.map((variant) => ({
        ...variant,
        resumeVersionId: variant.resumeVersionId || null,
        experiences: variant.experiences.filter((x) => Object.values(x).some(Boolean)),
        projects: variant.projects.filter((project) => Object.values(project).some(Boolean)),
        extras: Object.fromEntries(Object.entries(variant.extras).filter(([, v]) => v)),
      })),
    };
    await db.user.update({
      where: { id: user.id },
      data: { applicationProfile: cleaned as Prisma.InputJsonValue },
    });
    revalidatePath("/settings");
    return cleaned;
  });
}

/**
 * Pre-fills the structured 网申资料 from a resume — the user still reviews
 * and saves. One text call over the already-extracted resume content; the
 * point is to spare typing out five education/experience rows by hand.
 */
export async function extractApplicationProfile(resumeVersionId: string): Promise<ActionResult<ApplicationProfile>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const { resumeText } = await getResumeContext(resumeVersionId, user.id);
    const config = await getUserAiConfig(user.id);
    const raw = await callTextAi({
      config,
      prompt: `从下面这份简历里提取结构化信息，用来填网申表单。只提取简历里明确写了的，没写的字段留空字符串，不要猜。

简历：
${resumeText}

要求：
- education：每段教育经历一条，按时间倒序（最高/最近学历在前）。school 学校全称；major 专业；department 院系/学院（写了才填）；degree 学历（本科/硕士/博士/大专）；gpa 原样（如 "3.8/4.0" 或 "85/100"）；start/end 用 yyyy-MM，没有月份就 yyyy。
- experiences：实习/工作经历，按时间倒序。company 单位；department 部门（写了才填）；role 职位；start/end 同上；description 一两句概括做了什么（用简历原文的关键表述）。
- projects：项目经历，按时间倒序。name 项目名称；role 在项目中的角色；start/end 同上；description 项目背景、目标和内容；responsibilities 本人负责的工作与成果。只提取简历明确写出的项目，不要把实习单位当作项目。
- awards：获奖情况。name 奖项名称；issuer 颁发单位；level 等级；date 获奖时间；description 补充说明。只提取明确写出的奖项。
- campus：校园经历 / 学生工作（学生会、社团、班级、实验室学生职务等，不是实习也不是项目）。name 组织名称；role 担任职务；level 级别（校级/院级/班级）；start/end 同上；description 做了什么。
- skills：专业技能，每项一条。name 技能名称（如 Python、MATLAB、SolidWorks）；level 掌握程度（了解/熟悉/熟练/精通，简历写了才填）；category 类别（编程语言/软件工具/专业技能等）；description 留空。只提取简历「技能」部分明确列出的。
- languages：语言成绩，每门考试一条。name 考试/证书（CET-4、CET-6、雅思、托福、日语 N2 等）；language 语种（英语可留空）；score 分数；date 考试时间 yyyy-MM。只提取简历写了的。
- extras：politics 政治面貌、hometown 籍贯、ethnicity 民族、english 英语水平（如 CET-6 580）、currentCity 现居城市、researchDirection 研究方向、rank 成绩排名、courses 主修课程（逗号分隔）、homepage 个人主页/GitHub/作品链接、lab 实验室/课题组、hobbies 兴趣爱好、thesis 毕业论文题目——简历里有才填。
全部用中文。`,
      thinkingBudget: 512,
      timeoutMs: 60000,
      schema: {
        type: "OBJECT",
        properties: {
          education: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                school: { type: "STRING" }, major: { type: "STRING" }, department: { type: "STRING" }, degree: { type: "STRING" },
                gpa: { type: "STRING" }, start: { type: "STRING" }, end: { type: "STRING" },
              },
              required: ["school", "major", "department", "degree", "gpa", "start", "end"],
            },
          },
          experiences: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                company: { type: "STRING" }, department: { type: "STRING" }, role: { type: "STRING" }, start: { type: "STRING" },
                end: { type: "STRING" }, description: { type: "STRING" },
              },
              required: ["company", "department", "role", "start", "end", "description"],
            },
          },
          projects: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" }, role: { type: "STRING" }, start: { type: "STRING" },
                end: { type: "STRING" }, description: { type: "STRING" }, responsibilities: { type: "STRING" },
              },
              required: ["name", "role", "start", "end", "description", "responsibilities"],
            },
          },
          awards: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, issuer: { type: "string" }, level: { type: "string" }, date: { type: "string" }, description: { type: "string" } },
              required: ["name", "issuer", "level", "date", "description"],
            },
          },
          campus: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { name: { type: "STRING" }, role: { type: "STRING" }, level: { type: "STRING" }, start: { type: "STRING" }, end: { type: "STRING" }, description: { type: "STRING" } },
              required: ["name", "role", "level", "start", "end", "description"],
            },
          },
          skills: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { name: { type: "STRING" }, level: { type: "STRING" }, category: { type: "STRING" }, description: { type: "STRING" } },
              required: ["name", "level", "category", "description"],
            },
          },
          languages: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { name: { type: "STRING" }, language: { type: "STRING" }, score: { type: "STRING" }, date: { type: "STRING" } },
              required: ["name", "language", "score", "date"],
            },
          },
          extras: {
            type: "OBJECT",
            properties: {
              politics: { type: "STRING" }, hometown: { type: "STRING" }, ethnicity: { type: "STRING" },
              english: { type: "STRING" }, currentCity: { type: "STRING" },
              researchDirection: { type: "STRING" }, rank: { type: "STRING" }, courses: { type: "STRING" },
              homepage: { type: "STRING" }, lab: { type: "STRING" }, hobbies: { type: "STRING" }, thesis: { type: "STRING" },
            },
            required: ["politics", "hometown", "ethnicity", "english", "currentCity", "researchDirection", "rank", "courses", "homepage", "lab", "hobbies", "thesis"],
          },
        },
        required: ["education", "experiences", "projects", "awards", "campus", "skills", "languages", "extras"],
      },
    });
    const parsed = applicationProfileSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");
    return parsed.data;
  });
}
