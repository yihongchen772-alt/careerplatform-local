import { z } from "zod";
export type WorkflowItem = { id: string; title: string; done: boolean; dueDate?: string; taskId?: string };
export function parseWorkflowChecklist(value: unknown): Record<string, WorkflowItem[]> | null {
  const parsed = z.record(z.string(), z.array(z.object({ id: z.string(), title: z.string(), done: z.boolean(), dueDate: z.string().optional(), taskId: z.string().optional() })).max(100)).safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function stageChecklist(stage: string): WorkflowItem[] {
  const titles = /INTERVIEW/.test(stage) ? ["核对面试时间、时区和会议入口", "复习岗位要求与本次提交材料", "检查设备并准备作品或项目说明", "完成面试复盘"]
    : ["OFFER", "ACCEPTED"].includes(stage) ? ["核对薪资结构、工作地点和入职条件", "记录决策截止日期", "准备需要澄清的问题或谈薪方案"]
    : ["OA", "ASSESSMENT"].includes(stage) ? ["核对测评窗口和截止时间", "检查考试设备与要求", "安排模拟练习"]
    : ["REJECTED", "WITHDRAWN", "DECLINED", "CANCELLED"].includes(stage) ? ["记录结果与原因", "复盘并调整下一次申请"]
    : ["确认简历与补充材料完整", "记录联系人和适合的跟进时间", "准备下一阶段"];
  return titles.map((title, i) => ({ id: `${stage}-${i}`, title, done: false }));
}
export function communicationDraft(kind: string, company: string, title: string) {
  if (kind === "thanks") return `您好：\n\n感谢您安排 ${company}「${title}」的面试。通过交流，我对岗位和团队有了更清晰的了解。\n[补充一项面试中实际讨论的内容，以及自己的相关经历]\n\n如需补充材料，我会及时提供。感谢您的时间，期待后续反馈。\n[姓名]`;
  if (kind === "withdraw") return `您好：\n\n感谢贵司对我的关注。经过考虑，我希望撤回 ${company}「${title}」的申请。\n[可选：简短说明原因]\n\n感谢您在流程中投入的时间，祝招聘顺利。\n[姓名]`;
  return `您好：\n\n我此前申请了 ${company}「${title}」，想了解目前的招聘进展，以及是否需要我补充材料。\n[填写实际投递或面试日期；如有联系人称呼，请补充]\n\n感谢您的时间，期待回复。\n[姓名]`;
}
