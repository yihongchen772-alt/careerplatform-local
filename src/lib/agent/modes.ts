import type { ThinkingMode } from "@/lib/agent/llm";

export type AgentMode = "general" | "mock_interview" | "resume_tailor" | "offer_coach";

export type AgentModeMeta = {
  id: AgentMode;
  label: string;
  shortLabel: string;
  description: string;
  placeholder: string;
  quickQuestions: string[];
  defaultThinking: ThinkingMode;
};

export const AGENT_MODE_LIST: AgentModeMeta[] = [
  {
    id: "general",
    label: "综合求职管家",
    shortLabel: "综合",
    description: "日常规划、查投递与邮件、找岗位、记进度、解答网申问题",
    placeholder: "交给小欧一件事（支持粘贴截图 · Enter 发送）…",
    quickQuestions: ["今天有什么安排？", "算一下我的求职漏斗", "帮我准备下一场面试", "哪些该跟进了？", "帮我找新岗位"],
    defaultThinking: "balanced",
  },
  {
    id: "mock_interview",
    label: "模拟面试官",
    shortLabel: "模拟面试",
    description: "结合目标 JD 与你的简历逐题深挖（STAR 追问），每轮打分+改写示范，结束后一键存入面经",
    placeholder: "说一家公司/岗位开始模拟面试，或直接回答上一题…",
    quickQuestions: ["挑我下一场面试开始模拟", "深挖我简历里最核心的项目", "给我出一道高频场景/八股题", "结束模拟并总结面经"],
    defaultThinking: "deep",
  },
  {
    id: "resume_tailor",
    label: "简历精修专家",
    shortLabel: "简历精修",
    description: "对照目标岗位 JD 逐条拆解缺口，给出「原文 → 量化改写版」并可一键保存定制稿",
    placeholder: "告诉我要对标哪家公司/岗位，或直接粘贴 JD…",
    quickQuestions: ["对照我候选池最想投的岗位改简历", "帮我精修默认简历的项目描述", "看看我哪版简历进面率最高", "为这个岗位写一封定制自荐信"],
    defaultThinking: "deep",
  },
  {
    id: "offer_coach",
    label: "Offer 决策 & 谈薪顾问",
    shortLabel: "Offer 决策",
    description: "量化对比总包、时薪、通勤、加班与成长性，并生成可直接发送给 HR 的谈薪/argue 话术",
    placeholder: "对比手上的 Offer，或告诉我 HR 的开价帮你拟谈薪话术…",
    quickQuestions: ["量化对比我手上所有的 Offer", "帮我写一版 HR 谈薪/Argue 话术", "算一下各 Offer 的通勤与时薪", "保底 Offer 怎么礼貌拖时间？"],
    defaultThinking: "deep",
  },
];

export const AGENT_MODE_MAP: Record<AgentMode, AgentModeMeta> = Object.fromEntries(
  AGENT_MODE_LIST.map((m) => [m.id, m])
) as Record<AgentMode, AgentModeMeta>;

/**
 * Expert skill instructions appended to the system prompt only when an expert
 * mode is active, keeping everyday chat lean while giving deep domain rigor on demand.
 */
export function buildModePrompt(mode: AgentMode): string {
  switch (mode) {
    case "mock_interview":
      return `\n\n## 当前专家模式：模拟面试官（Mock Interviewer）
你现在进入「实战模拟面试官」状态，严格遵循以下节奏：
1. **开场先对齐上下文**：如果用户刚开启模拟，先调 get_application / get_position 读目标岗位 JD 和历史面经，并调 resume_context 读他的简历。如果用户没指定哪家，先看他最近要面试的投递并确认。
2. **一轮只问一道题（绝不一次甩一长串题）**：先出 1 道高针对性问题（优先针对他简历里真实项目的 STAR 深挖、JD 核心技术/业务场景题，或这家公司高频真题）。
3. **收到回答后按 4 段反馈**：
   - **评分**：X / 10 分（客观不捧杀）
   - **亮点**：具体夸到点子上
   - **扣分点 / 面试官会怎么追问**：指出逻辑跳跃、缺数据指标或技术深度不够的地方
   - **高分示范话术**：用他真实经历帮他改写一段 3-5 句可直接背诵的精炼表达
   - 最后自然抛出**下一道追问题或新题**。
4. **结束复盘沉淀**：当用户说“结束”“总结”“不练了”时，输出本场模拟的综合评分、薄弱知识点清单、最需要补的 3 个准备动作，并用 propose_actions 的 save_note 生成「把本场模拟复盘存进面经」按钮（如能对应到投递）。`;

    case "resume_tailor":
      return `\n\n## 当前专家模式：简历精修与 JD 对齐专家（Resume Tailor）
你现在进入「简历精修专家」状态，严格遵循以下原则：
1. **先读真实材料**：先调用 resume_context 读默认或指定简历，再调用 get_position / get_application（或看用户粘贴的 JD）拿到目标岗位要求；必要时调用 get_funnel_analytics(groupBy="resume") 看不同版本简历的真实进面率。
2. **绝不编造经历**：只基于他简历里**真实存在**的项目和技能进行提炼、补齐 STAR 结构、突出量化结果（若缺指标，用「[建议补充：如 QPS/耗时/准确率提升 X%]」占位提示，绝不替他瞎编数字）。
3. **结构化输出对比表**：用 Markdown 表格给出：
   | JD 核心诉求 | 当前简历问题 | 原文片段 | 建议改写版（含关键词与指标占位） |
4. **可落盘交付**：如果用户需要为某个具体岗位写定制自荐信、自我介绍或岗位定制简历修改稿，写完后主动调用 propose_actions 的 save_cover_letter 生成按钮，让他一键存到该岗位档案里。`;

    case "offer_coach":
      return `\n\n## 当前专家模式：Offer 量化决策与谈薪顾问（Offer & Negotiation Coach）
你现在进入「Offer 决策与谈薪顾问」状态，严格遵循以下方法论：
1. **先拉全量数据**：先调用 get_workspace_overview(section="offers") 和 get_funnel_analytics(groupBy="overview")，结合用户长期记忆里的城市/薪资底线/方向偏好做判断；必要时用 research_web 查公司最新校招薪资爆料、年终兑现口碑与业务线稳定性。
2. **量化多维对比表**：当对比 2 个及以上 Offer 时，必须输出清晰的 Markdown 对比表（月薪结构/年总包、预估月均工作时长与折算时薪、单程通勤分钟数与年通勤耗时、加班强度、技术/行业成长性、毁约/裁员风险），并给出**明确的第一推荐排序和核心取舍理由**。
3. **谈薪/Argue 话术可直接复制**：当用户问怎么谈薪、怎么用 A 公司 compete B 公司、怎么礼貌延长签三方/Offer 截止日时，给出可直接发给 HR 的微信/邮件/电话逐字话术脚本（用引用块或代码块包好，方便一键复制），并注明底线与风险提醒。`;

    default:
      return "";
  }
}

const DEEP_INTENT_RE =
  /规划|计划|对比|比较|分析|漏斗|转化率|复盘|精修|改简历|简历优化|模拟面试|追问|深挖|谈薪|argue|竞价|选择|去哪家|值不值得|战略|长远|弱点|短板|面经总结|写一封|求职信|自荐信/i;

const FAST_INTENT_RE =
  /^(今天有什么|明天有什么|下一场|几点|什么时候|最近面试|帮我记|记一下|记一条|改到|改成|删掉|标记完成|你好|在吗|谢谢|好的|收到)/i;

/**
 * Smart fast / balanced / deep reasoning router.
 * - Explicit user override ("deep" or "fast") always wins.
 * - Expert modes default to "deep" so mock interviews, resume tailoring, and
 *   offer comparisons get thorough reasoning.
 * - General mode routes short lookups to "fast" (low latency, lower token cost)
 *   and complex decision/analysis prompts to "deep".
 */
export function routeThinkingDepth(params: {
  message: string;
  mode: AgentMode;
  requested?: "auto" | ThinkingMode;
  hasImages?: boolean;
  hasPage?: boolean;
}): ThinkingMode {
  if (params.requested && params.requested !== "auto") return params.requested;
  if (params.mode !== "general") return "deep";
  const text = params.message.trim();
  if (DEEP_INTENT_RE.test(text) || text.length >= 140) return "deep";
  if (!params.hasImages && !params.hasPage && text.length <= 28 && FAST_INTENT_RE.test(text)) {
    return "fast";
  }
  return "balanced";
}
