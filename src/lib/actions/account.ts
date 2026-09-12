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
import { applicationProfileSchema, type ApplicationProfile } from "@/lib/application-profile";

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
    // Drop fully blank rows — an empty education row still counts as
    // "education[0]" to the keyword matcher and would fill nothing.
    const cleaned: ApplicationProfile = {
      education: data.education.filter((e) => Object.values(e).some(Boolean)),
      experiences: data.experiences.filter((x) => Object.values(x).some(Boolean)),
      extras: Object.fromEntries(Object.entries(data.extras).filter(([, v]) => v)),
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
- education：每段教育经历一条，按时间倒序（最高/最近学历在前）。school 学校全称；major 专业；degree 学历（本科/硕士/博士/大专）；gpa 原样（如 "3.8/4.0" 或 "85/100"）；start/end 用 yyyy-MM，没有月份就 yyyy。
- experiences：实习/工作经历，按时间倒序。company 单位；role 职位；start/end 同上；description 一两句概括做了什么（用简历原文的关键表述）。
- extras：politics 政治面貌、hometown 籍贯、ethnicity 民族、english 英语水平（如 CET-6 580）、currentCity 现居城市——简历里有才填。
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
                school: { type: "STRING" }, major: { type: "STRING" }, degree: { type: "STRING" },
                gpa: { type: "STRING" }, start: { type: "STRING" }, end: { type: "STRING" },
              },
              required: ["school", "major", "degree", "gpa", "start", "end"],
            },
          },
          experiences: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                company: { type: "STRING" }, role: { type: "STRING" }, start: { type: "STRING" },
                end: { type: "STRING" }, description: { type: "STRING" },
              },
              required: ["company", "role", "start", "end", "description"],
            },
          },
          extras: {
            type: "OBJECT",
            properties: {
              politics: { type: "STRING" }, hometown: { type: "STRING" }, ethnicity: { type: "STRING" },
              english: { type: "STRING" }, currentCity: { type: "STRING" },
            },
            required: ["politics", "hometown", "ethnicity", "english", "currentCity"],
          },
        },
        required: ["education", "experiences", "extras"],
      },
    });
    const parsed = applicationProfileSchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");
    return parsed.data;
  });
}
