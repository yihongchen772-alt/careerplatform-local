"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { buildTodos } from "@/lib/todos";
import { STAGE_LABELS } from "@/lib/stage-labels";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";

export type AssistantChatMessage = { role: "user" | "assistant"; content: string };

// Keep the prompt bounded — a pool/application list that's grown large over
// a whole job-search season shouldn't blow up every single chat turn's cost.
const MAX_ITEMS = 25;
const MAX_HISTORY_TURNS = 8;

async function buildSnapshot(userId: string): Promise<string> {
  const [positions, applications, stageHistories, personalTasks, resumeVersions] =
    await Promise.all([
      db.position.findMany({
        where: { userId },
        include: { company: true },
        orderBy: { createdAt: "desc" },
        take: MAX_ITEMS,
      }),
      db.application.findMany({
        where: { userId },
        include: { company: true },
        orderBy: { appliedDate: "desc" },
        take: MAX_ITEMS,
      }),
      db.stageHistory.findMany({
        where: { application: { userId }, nextDeadline: { not: null } },
        include: { application: { include: { company: true } } },
      }),
      db.personalTask.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      db.resumeVersion.findMany({
        where: { userId },
        select: { id: true, name: true, targetTrack: true, checkScore: true, isDefault: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const todos = buildTodos(applications, positions, stageHistories, personalTasks);

  const sections: string[] = [];

  sections.push(
    "候选岗位池：\n" +
      (positions.length === 0
        ? "（空）"
        : positions
            .map((p) => {
              const parts = [
                `${p.company.name} · ${p.title}`,
                p.track ? `方向：${p.track}` : null,
                p.location ? `地点：${p.location}` : null,
                p.salaryMin || p.salaryMax ? `薪资：${p.salaryMin ?? "?"}-${p.salaryMax ?? "?"}K` : null,
                p.interestScore != null ? `综合得分：${p.interestScore}` : null,
                p.deadline ? `截止：${p.deadline.toISOString().slice(0, 10)}` : null,
                `状态：${p.status}`,
                p.jdText ? `JD 摘要：${p.jdText.slice(0, 300)}` : "（无 JD 正文）",
              ].filter(Boolean);
              return `- [岗位ID:${p.id}] ${parts.join("；")}`;
            })
            .join("\n"))
  );

  sections.push(
    "投递记录：\n" +
      (applications.length === 0
        ? "（空）"
        : applications
            .map((a) => {
              const parts = [
                `${a.company.name} · ${a.title}`,
                `阶段：${STAGE_LABELS[a.currentStage]}`,
                `投递日期：${a.appliedDate.toISOString().slice(0, 10)}`,
              ].filter(Boolean);
              return `- [投递ID:${a.id}] ${parts.join("；")}`;
            })
            .join("\n"))
  );

  sections.push(
    "近期待办/截止日期（按紧急程度排序）：\n" +
      (todos.length === 0
        ? "（没有紧急事项）"
        : todos.map((t) => `- ${t.label}：${t.sublabel}`).join("\n"))
  );

  sections.push(
    "简历版本：\n" +
      (resumeVersions.length === 0
        ? "（还没上传过简历）"
        : resumeVersions
            .map(
              (r) =>
                `- ${r.name}${r.isDefault ? "（默认）" : ""}${r.targetTrack ? `，方向：${r.targetTrack}` : ""}${r.checkScore != null ? `，AI 体检分：${r.checkScore}` : "，还没做过 AI 体检"}`
            )
            .join("\n"))
  );

  return sections.join("\n\n");
}

const replySchema = z.object({ reply: z.string() });

export async function askAssistant(
  message: string,
  history: AssistantChatMessage[]
): Promise<ActionResult<{ reply: string }>> {
  return toActionResult(async () => {
    const user = await requireUser();
    if (!message.trim()) throw new UserFacingError("说点什么吧");

    const config = await getUserAiConfig(user.id);
    if (!config) {
      throw new UserFacingError("先去账号设置配置一个 AI Key 才能用这个功能");
    }

    const snapshot = await buildSnapshot(user.id);
    const recentHistory = history.slice(-MAX_HISTORY_TURNS * 2);
    const historyText = recentHistory
      .map((h) => `${h.role === "user" ? "用户" : "助手"}：${h.content}`)
      .join("\n");

    const prompt = `你是这个求职跟踪 App 里的 AI 助手，帮用户快速看一眼自己的求职数据、做判断，而不是让用户自己一页页翻。

用户当前的求职数据快照：
${snapshot}

${historyText ? `之前的对话：\n${historyText}\n` : ""}
用户现在问：${message}

回答要求：
- 直接用中文口语化回答，像同事帮忙看一眼，不要机械地照抄上面的数据列表
- 如果问题是"哪个岗位/投递最值得...""该选哪个"这类比较判断，逐一分析给出明确结论和理由，不要只罗列数据不表态
- 只依据上面给出的数据快照回答；快照里没有的信息（比如某个岗位没有 JD 正文、简历没做过体检）如实说明限制，不要编造
- 简短，一般 2-6 句话说清楚就行，除非用户明确要展开分析`;

    const raw = await callTextAi({
      config,
      prompt,
      thinkingBudget: 1024,
      timeoutMs: 60000,
      schema: {
        type: "OBJECT",
        properties: { reply: { type: "STRING" } },
        required: ["reply"],
      },
    });

    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

    return { reply: parsed.data.reply };
  });
}
