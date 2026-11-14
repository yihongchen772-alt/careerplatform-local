"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getResumeContext } from "@/lib/resume-context";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import { inferBriefMode, interviewBriefAiSchema, parseInterviewBrief, type BriefMode, type InterviewBrief } from "@/lib/interview-brief";
import { applicationJd } from "@/lib/application-jd";
import { searchWebSnippets } from "@/lib/city-search";
import { STAGE_LABELS, AUTO_NOTE_PREFIXES } from "@/lib/stage-labels";
import type { InterviewQa } from "@/lib/validation";

/** Writes (or rewrites) the 面试/笔试速览 of one 投递. One AI call. */
export async function generateInterviewBrief(
  applicationId: string,
  resumeVersionId: string | null,
  options?: { mode?: BriefMode; includeWebSearch?: boolean }
): Promise<ActionResult<InterviewBrief>> {
  return toActionResult(async () => {
    const user = await requireUser();
    const application = await db.application.findFirst({
      where: { id: applicationId, userId: user.id },
      include: { company: true, position: true, interviewQA: true },
    });
    if (!application) throw new UserFacingError("未找到该投递记录");
    const mode: BriefMode = options?.mode ?? inferBriefMode(application.currentStage, application.currentStageLabel);
    const resumeId = resumeVersionId || application.resumeVersionId || (await db.resumeVersion.findFirst({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }], select: { id: true } }))?.id;
    if (!resumeId) throw new UserFacingError("先去「简历版本」上传一份简历，速览要结合你的经历");
    const [{ resumeText }, notes, webSnippets] = await Promise.all([
      getResumeContext(resumeId, user.id),
      // The applicant's own notes on this company: what they were asked before.
      db.stageHistory.findMany({
        where: { application: { userId: user.id, companyId: application.companyId }, note: { not: null }, AND: AUTO_NOTE_PREFIXES.map((prefix) => ({ NOT: { note: { startsWith: prefix } } })) },
        select: { stage: true, stageLabel: true, note: true },
        orderBy: { enteredAt: "desc" },
        take: 6,
      }),
      options?.includeWebSearch
        ? searchWebSnippets(
            `${application.company.name} ${application.title} ${mode === "exam" ? "笔试 真题 题型" : "面经 真题 面试"}`,
            2200
          ).catch(() => "")
        : Promise.resolve(""),
    ]);

    const jd = applicationJd(application);
    const qa = application.interviewQA ? (application.interviewQA.content as InterviewQa) : null;
    const round = application.currentStageLabel || STAGE_LABELS[application.currentStage];
    const isExam = mode === "exam";

    const prompt = isExam
      ? `你在帮候选人做笔试/测评前最后 15 分钟的「笔试抱佛脚速览」，要一页能读完，不要长篇大论。

公司：${application.company.name}
岗位：${application.title}
这一轮：${round}
${jd ? `岗位要求（JD）：\n${jd.slice(0, 6000)}` : "没有 JD 正文，只能依据岗位名称判断，要点会更通用一些。"}

候选人简历（用于判断熟练度与薄弱盲区）：
${resumeText}
${notes.length ? `\n候选人之前在这家公司记下的笔面试复盘：\n${notes.map((n) => `- ${n.stageLabel || STAGE_LABELS[n.stage]}：${(n.note ?? "").slice(0, 800)}`).join("\n")}` : ""}
${webSnippets ? `\n联网搜到的这家公司/同类岗位公开笔试真题线索（如有无关噪点请自动甄别）：\n${webSnippets}` : ""}
${qa ? `\n之前为这个岗位生成过的预测题（可参考、去重）：\n${qa.questions.slice(0, 8).map((q) => `- ${q.question}`).join("\n")}` : ""}

返回：
- summary：一两句话，这场笔试主要考什么模块、怎样拿高分
- focus：3-5 个高频核心考点/题型（如编程题侧重点、基础八股、行测/专业主观题），why 说明结合 JD 或岗位的原因
- stories：3-5 条「重点复习模块与开放题怎么结合自身经历作答」：point（考点/题型）、experience（简历里**真实存在**的相关技术栈/项目，缺失则如实指出盲区）、howToTell（考前 10 分钟速记口诀或简答题答题模板）
- questions：6-8 道高频笔试真题/编程思路/专业简答题，每题 hint 给解题思路与得分关键词
- askBack：3-4 条考试时间分配与做题策略（如编程保底先写暴力解、客观题耗时上限）
- reminders：2-4 条机考/笔试实操提醒（如双机位/IDE 环境/草稿纸/交卷前检查）
全部用中文，每条尽量短。`
      : `你在帮候选人做面试前最后 15 分钟的准备，要一页能读完的「面试速览」，不要长篇大论。

公司：${application.company.name}
岗位：${application.title}
这一轮：${round}
${jd ? `岗位要求（JD）：\n${jd.slice(0, 6000)}` : "没有 JD 正文，只能依据岗位名称判断，要点会更通用一些。"}

候选人简历：
${resumeText}
${notes.length ? `\n候选人之前在这家公司记下的面试复盘：\n${notes.map((n) => `- ${n.stageLabel || STAGE_LABELS[n.stage]}：${(n.note ?? "").slice(0, 800)}`).join("\n")}` : ""}
${webSnippets ? `\n联网搜到的这家公司/岗位公开面经与高频真题线索（如有无关噪点请自动甄别）：\n${webSnippets}` : ""}
${qa ? `\n之前为这个岗位生成过的预测题（可参考、去重）：\n${qa.questions.slice(0, 8).map((q) => `- ${q.question}`).join("\n")}` : ""}

返回：
- summary：一两句话，这场面试最该准备什么
- focus：3-5 个这个岗位/这一轮最看重的点，每个给 point（要点）和 why（为什么，结合 JD 原文）
- stories：3-5 条「用哪段经历回答」：point（对应哪个要点）、experience（简历里**真实存在**的具体经历，写清是哪段）、howToTell（30 秒怎么讲：情境-做法-结果）。简历里没有对应经历就如实说没有，并给补救思路，绝不编造
- questions：6-8 道这一轮最可能被问的题，每题 hint 给一句答题要点
- askBack：3-4 个面试结尾可以反问的好问题（贴合这家公司和岗位，不要问薪资福利）
- reminders：2-4 条临场提醒（比如线上面试测设备、带作品集、控制自我介绍时长），只写跟这一轮相关的
全部用中文，每条尽量短。`;

    const config = await getUserAiConfig(user.id);
    const raw = await callTextAi({ config, prompt, thinkingBudget: 1536, timeoutMs: 90000, schema: interviewBriefAiSchema });
    const parsed = parseInterviewBrief(raw);
    if (!parsed) throw new UserFacingError("AI 返回格式异常，请重试");
    const brief: InterviewBrief = { ...parsed, mode, webUsed: Boolean(webSnippets) };
    await db.interviewBrief.upsert({
      where: { applicationId },
      create: { userId: user.id, applicationId, content: brief },
      update: { content: brief },
    });
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath(`/applications/${applicationId}/brief`);
    return brief;
  });
}
