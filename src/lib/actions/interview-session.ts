"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { getResumeContext } from "@/lib/resume-context";
import { getUserAiConfig, callTextAi } from "@/lib/ai-providers";
import { toActionResult, UserFacingError, type ActionResult } from "@/lib/action-result";
import {
  startInterviewSessionSchema,
  sendInterviewMessageSchema,
  interviewFeedbackSchema,
  type InterviewFeedback,
} from "@/lib/validation";
import type { InterviewMessageRole } from "@prisma/client";

const MAX_TURNS_HINT = 8;

export type InterviewMessageDTO = {
  id: string;
  role: InterviewMessageRole;
  content: string;
};

/** Real back-and-forth chat — several AI calls per session, so it needs the
 * user's own key rather than the shared quota. The one-shot 面试攻略/题库
 * features stay on shared quota; this one doesn't. */
async function requireOwnAiConfig(userId: string) {
  const config = await getUserAiConfig(userId);
  if (!config) {
    throw new UserFacingError(
      "先在「账号设置」里配置你自己的 AI API Key 才能用模拟面试对话"
    );
  }
  return config;
}

async function buildContext(userId: string, resumeVersionId: string, positionId?: string | null, targetRole?: string) {
  const { resumeText, resumeName } = await getResumeContext(resumeVersionId, userId);

  let jobDescription: string;
  if (positionId) {
    const position = await db.position.findFirst({
      where: { id: positionId, userId },
      include: { company: true },
    });
    if (!position) throw new UserFacingError("未找到该候选岗位");
    jobDescription = [
      `公司：${position.company.name}`,
      `岗位：${position.title}`,
      position.track ? `方向：${position.track}` : null,
      position.jdText ? `\nJD 正文：\n${position.jdText.slice(0, 4000)}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    jobDescription = `目标方向：${targetRole || "候选人简历里的求职方向"}`;
  }

  return { resumeText, resumeName, jobDescription };
}

export async function startInterviewSession(
  input: z.infer<typeof startInterviewSessionSchema>
): Promise<ActionResult<{ sessionId: string; messages: InterviewMessageDTO[] }>> {
  return toActionResult(() => runStart(input));
}

async function runStart(input: z.infer<typeof startInterviewSessionSchema>) {
  const user = await requireUser();
  const data = startInterviewSessionSchema.parse(input);
  const config = await requireOwnAiConfig(user.id);

  const { resumeText, jobDescription } = await buildContext(
    user.id,
    data.resumeVersionId,
    data.positionId,
    data.targetRole
  );

  const prompt = `你是一位经验丰富的技术/HR 面试官，正在对一名中国应届生做模拟面试。这是面试的第一个问题。

目标岗位：
${jobDescription}

候选人简历情况：
${resumeText}

请提出第一个面试问题——通常从自我介绍或者简历里最突出的一段经历切入。只返回这一个问题本身，不要加"你好"之类的寒暄，不要一次问多个问题。用中文。`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 512,
    schema: {
      type: "OBJECT",
      properties: { question: { type: "STRING" } },
      required: ["question"],
    },
  });
  const parsed = z.object({ question: z.string() }).safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  const session = await db.interviewSession.create({
    data: {
      userId: user.id,
      resumeVersionId: data.resumeVersionId,
      positionId: data.positionId || undefined,
      targetRole: data.positionId ? undefined : data.targetRole || undefined,
    },
  });
  const message = await db.interviewMessage.create({
    data: { sessionId: session.id, role: "ASSISTANT", content: parsed.data.question },
  });

  revalidatePath("/interview");
  return { sessionId: session.id, messages: [toDTO(message)] };
}

export async function sendInterviewMessage(
  sessionId: string,
  content: string
): Promise<ActionResult<{ messages: InterviewMessageDTO[]; ended: boolean }>> {
  return toActionResult(() => runSend(sessionId, content));
}

async function runSend(sessionId: string, content: string) {
  const user = await requireUser();
  const data = sendInterviewMessageSchema.parse({ content });

  const session = await db.interviewSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } }, position: { include: { company: true } } },
  });
  if (!session) throw new UserFacingError("未找到该面试记录");
  if (session.status === "ENDED") throw new UserFacingError("这场模拟面试已经结束了");

  const config = await requireOwnAiConfig(user.id);

  await db.interviewMessage.create({
    data: { sessionId, role: "USER", content: data.content },
  });

  const { resumeText, jobDescription } = await buildContext(
    user.id,
    session.resumeVersionId,
    session.positionId,
    session.targetRole ?? undefined
  );

  const transcript = [
    ...session.messages.map((m) => `${m.role === "ASSISTANT" ? "面试官" : "候选人"}：${m.content}`),
    `候选人：${data.content}`,
  ].join("\n");

  const turnsSoFar = session.messages.filter((m) => m.role === "ASSISTANT").length;
  const prompt = `你是一位技术/HR 面试官，正在对一名中国应届生做模拟面试，对话已经在进行中。

目标岗位：
${jobDescription}

候选人简历情况：
${resumeText}

到目前为止的对话：
${transcript}

请针对候选人刚才的回答，给出简短的反应（可以是一句追问，或者简单点评后转下一题），然后提出下一个问题。${
    turnsSoFar >= MAX_TURNS_HINT
      ? "已经问了不少轮了，如果候选人的回答已经比较完整，可以说明面试差不多了，问最后一个综合性问题，或者直接说可以结束面试了。"
      : ""
  }只返回你要说的这一段话（可能包含点评+下一个问题），不要写"面试官："这样的前缀。用中文。`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 512,
    schema: {
      type: "OBJECT",
      properties: { message: { type: "STRING" } },
      required: ["message"],
    },
  });
  const parsed = z.object({ message: z.string() }).safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  const assistantMessage = await db.interviewMessage.create({
    data: { sessionId, role: "ASSISTANT", content: parsed.data.message },
  });

  return {
    messages: [assistantMessage].map(toDTO),
    ended: false,
  };
}

export async function endInterviewSession(
  sessionId: string
): Promise<ActionResult<InterviewFeedback>> {
  return toActionResult(() => runEnd(sessionId));
}

async function runEnd(sessionId: string) {
  const user = await requireUser();

  const session = await db.interviewSession.findFirst({
    where: { id: sessionId, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) throw new UserFacingError("未找到该面试记录");
  if (session.status === "ENDED" && session.feedback) {
    return session.feedback as InterviewFeedback;
  }

  const config = await requireOwnAiConfig(user.id);
  const { resumeText, jobDescription } = await buildContext(
    user.id,
    session.resumeVersionId,
    session.positionId,
    session.targetRole ?? undefined
  );

  const transcript = session.messages
    .map((m) => `${m.role === "ASSISTANT" ? "面试官" : "候选人"}：${m.content}`)
    .join("\n");

  const prompt = `以下是一场模拟面试的完整对话记录，请给出面试后的整体反馈。

目标岗位：
${jobDescription}

候选人简历情况：
${resumeText}

完整对话：
${transcript}

请给出：
- overallScore：0-100 的综合表现分
- strengths：候选人表现好的地方，要具体（引用对话里的实际回答）
- improvements：需要改进的地方，要具体、可执行
- summary：一两句总体评价

全部用中文。`;

  const raw = await callTextAi({
    config,
    prompt,
    thinkingBudget: 1024,
    timeoutMs: 60000,
    schema: {
      type: "OBJECT",
      properties: {
        overallScore: { type: "NUMBER" },
        strengths: { type: "ARRAY", items: { type: "STRING" } },
        improvements: { type: "ARRAY", items: { type: "STRING" } },
        summary: { type: "STRING" },
      },
      required: ["overallScore", "strengths", "improvements", "summary"],
    },
  });
  const parsed = interviewFeedbackSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("AI 返回格式异常，请重试");

  await db.interviewSession.update({
    where: { id: sessionId },
    data: { status: "ENDED", feedback: parsed.data },
  });

  revalidatePath("/interview");
  revalidatePath(`/interview/${sessionId}`);
  return parsed.data;
}

function toDTO(m: { id: string; role: InterviewMessageRole; content: string }): InterviewMessageDTO {
  return { id: m.id, role: m.role, content: m.content };
}
