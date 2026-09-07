import { z } from "zod";

export const agentDecisionSchema = z.object({
  tool: z.enum(["search_records", "resume_context", "research_web", "prepare_application", "finish"]),
  query: z.string().max(600).default(""),
  targetId: z.string().max(150).default(""),
});
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type AgentStep = {
  tool: string;
  label: string;
  status: "success" | "error";
  summary: string;
  href?: string;
};
export type ToolResult = { data: string; summary: string; href?: string };
const labels: Record<AgentDecision["tool"], string> = {
  search_records: "查询求职记录",
  resume_context: "读取简历摘要",
  research_web: "联网研究公司与岗位",
  prepare_application: "准备投递材料和网申入口",
  finish: "整理结果",
};

/** The model can select only read tools. Mutations remain explicit UI actions. */
export async function runAgentLoop({ decide, execute, maxSteps = 4 }: {
  decide: (observations: string) => Promise<unknown>;
  execute: (decision: AgentDecision) => Promise<ToolResult>;
  maxSteps?: number;
}) {
  const steps: AgentStep[] = [];
  const observations: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < Math.min(Math.max(maxSteps, 0), 4); i++) {
    let decision: AgentDecision;
    try {
      decision = agentDecisionSchema.parse(await decide(observations.join("\n\n")));
    } catch {
      steps.push({ tool: "planner", label: "选择下一步", status: "error", summary: "工具规划失败，将根据已获取的数据回答。" });
      observations.push("工具规划失败；不得声称尚未执行的查询或研究已完成。");
      break;
    }
    if (decision.tool === "finish") break;
    const key = JSON.stringify(decision);
    if (seen.has(key)) {
      observations.push("已停止重复的工具请求，请使用已有结果作答。");
      break;
    }
    seen.add(key);
    try {
      const result = await execute(decision);
      steps.push({ tool: decision.tool, label: labels[decision.tool], status: "success", summary: result.summary, href: result.href });
      observations.push(`${labels[decision.tool]} ${JSON.stringify(decision)}\n${result.data.slice(0, 14000)}`);
    } catch (error) {
      const summary = error instanceof Error ? error.message.slice(0, 300) : "工具执行失败";
      steps.push({ tool: decision.tool, label: labels[decision.tool], status: "error", summary });
      observations.push(`${labels[decision.tool]}执行失败：${summary}。不能把失败当作查询无结果。`);
    }
  }
  if (steps.length >= Math.min(maxSteps, 4)) observations.push("本轮工具预算已用完；如仍有未完成步骤，须明确说明。");
  return { steps, observations: observations.join("\n\n") };
}
