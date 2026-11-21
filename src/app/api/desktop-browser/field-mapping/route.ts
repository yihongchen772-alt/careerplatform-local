import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { atsFamilyFor } from "@/lib/ats-family";
import { requireUser } from "@/lib/session";
const PROFILE_REF_REGEX =
  /^(?:name|phone|email|gender|birthDate|currentCity|country|nationality|englishName|exchange|targetRole|selfIntro|politics|hometown|ethnicity|english|wechat|qq|expectedSalary|availableFrom|internshipDuration|address|researchDirection|researchTopic|rank|acceptAdjust|jobSource|courses|homepage|lab|hobbies|thesis|idType|idNumber|passportNumber|custom:[^:]{1,120}|partyDate|birthplace|householdPlace|householdType|sourcePlace|archivePlace|marital|health|height|weight|colorVision|onlyChild|religion|relativeInCompany|firstWorkDate|computerLevel|certificates|campusZone|failedCourses|advisor|emergencyName|emergencyRelation|emergencyPhone|employmentStatus|workYears|currentSalary|noticePeriod|leaveReason|managementScale|nonCompete|summary:(?:education|experience|project|award|campus|skill|language)(?::memory:[^:]+:[^:]+)?|row:(?:education|experience|project|award|campus|skill|language):(?:memory:[^:]+:[^:]+|[^:]+):(?:school|major|department|degree|gpa|start|end|company|role|name|description|responsibilities|link|teamSize|issuer|level|category|date|language|score|range|summary))$/;

const schema = z.object({
  contextKey: z.string().min(1).max(16384),
  url: z.string().max(2000).optional(),
  mappings: z.array(z.object({ fieldKey: z.string().min(1).max(2000), ref: z.string().max(3000) })).max(500),
});
export async function POST(request: Request) {
  const user = await requireUser();
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "字段对应关系无效" }, { status: 400 });
  const validMappings = input.data.mappings.filter((m) => PROFILE_REF_REGEX.test(m.ref));
  if (input.data.mappings.length > 0 && validMappings.length === 0) {
    return NextResponse.json({ error: "字段对应关系无效" }, { status: 400 });
  }
  const family = atsFamilyFor(input.data.url || input.data.contextKey);
  await db.$transaction(async (tx) => {
    const saved = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { autofillMappings: true } });
    const existing = Array.isArray(saved.autofillMappings) ? saved.autofillMappings as { contextKey: string; fieldKey: string; ref: string; atsFamily?: string }[] : [];
    const mappings = validMappings.map((m) => ({ ...m, contextKey: input.data.contextKey, ...(family ? { atsFamily: family } : {}) }));
    await tx.user.update({ where: { id: user.id }, data: { autofillMappings: [...existing.filter((m) => !mappings.some((n) => n.contextKey === m.contextKey && n.fieldKey === m.fieldKey)), ...mappings].slice(-1000) } });
  });
  return NextResponse.json({ ok: true, saved: validMappings.length });
}
