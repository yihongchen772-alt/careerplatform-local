import { averageByDimension, type TestDefinition, type TestItem } from "./types";

// Self-authored items inspired by the public D/I/S/C behavioral-style
// structure — not a reproduction of any specific commercial DISC assessment.
const items: TestItem[] = [
  { id: "d1", dimension: "D", text: "遇到问题我倾向直接推动解决，而不是先花时间讨论" },
  { id: "d2", dimension: "D", text: "我说话比较直接，喜欢直奔结果" },
  { id: "d3", dimension: "D", text: "面对竞争或挑战，我会觉得有干劲而不是有压力" },
  { id: "d4", dimension: "D", text: "团队没有明确方向时，我倾向主动拍板" },
  { id: "d5", dimension: "D", text: "比起过程细节，我更在意最终有没有拿到结果" },

  { id: "i1", dimension: "I", text: "我喜欢用有感染力的方式把想法讲给别人听" },
  { id: "i2", dimension: "I", text: "认识新的人，我很快就能聊起来" },
  { id: "i3", dimension: "I", text: "团队氛围低落时，我会主动想办法活跃气氛" },
  { id: "i4", dimension: "I", text: "我比较容易表达自己的热情和情绪，不太藏着" },
  { id: "i5", dimension: "I", text: "别人的认可和关注对我来说是重要的动力" },

  { id: "s1", dimension: "S", text: "我更喜欢稳定、可预期的节奏，而不是频繁变化" },
  { id: "s2", dimension: "S", text: "团队里我愿意配合别人的安排，不太坚持一定要按我的来" },
  { id: "s3", dimension: "S", text: "我做事比较有耐心，愿意花时间把关系维护好" },
  { id: "s4", dimension: "S", text: "面对冲突，我倾向先安抚情绪、找共识，而不是马上争论对错" },
  { id: "s5", dimension: "S", text: "长期稳定地做一件熟悉的事，我不会觉得腻" },

  { id: "c1", dimension: "C", text: "做事之前，我会先把规则、标准搞清楚" },
  { id: "c2", dimension: "C", text: "我在意准确性和细节，不喜欢差不多就行" },
  { id: "c3", dimension: "C", text: "做决定前我倾向多收集信息、多分析，而不是凭直觉" },
  { id: "c4", dimension: "C", text: "我对自己和别人的工作质量要求比较高" },
  { id: "c5", dimension: "C", text: "遇到没把握的事，我会先谨慎评估风险，而不是先冲" },
];

const LABELS: Record<string, string> = {
  D: "支配型（D）",
  I: "影响型（I）",
  S: "稳健型（S）",
  C: "谨慎型（C）",
};

const TEXTS: Record<string, string> = {
  D: "目标导向、行动力强，敢于做决定和承担结果，适合需要推动进度、拍板决策的角色。求职时可以突出你主导过的项目和拿到的结果。",
  I: "擅长表达和感染他人，人际互动是你的能量来源，适合需要沟通、对外展示、团队氛围调动的角色。面试中通常会有不错的临场表现。",
  S: "稳定、耐心、重视关系和团队和谐，适合需要长期投入、稳定输出的角色。求职时可以强调你的可靠性和团队协作经历。",
  C: "严谨、注重细节和标准，决策前会充分评估，适合对准确性要求高的岗位（如质量、数据、财务类）。面试准备阶段你通常会做得比别人更充分。",
};

export const discTest: TestDefinition = {
  id: "DISC",
  title: "行为风格测试（DISC 参考版）",
  subtitle: "D/I/S/C 四种行为风格倾向，自测参考版，非官方 DISC 测评",
  dimensions: [
    { key: "D", label: "支配型", description: "目标导向、直接、敢于决策" },
    { key: "I", label: "影响型", description: "外向、擅长感染和说服他人" },
    { key: "S", label: "稳健型", description: "稳定、有耐心、重视和谐" },
    { key: "C", label: "谨慎型", description: "严谨、注重细节和准确性" },
  ],
  items,
  scale: { min: 1, max: 5, minLabel: "很不符合", maxLabel: "很符合" },
  score: (answers) => averageByDimension(items, answers),
  interpret: (scores) => {
    const dims = ["D", "I", "S", "C"];
    const details = dims.map((dim) => ({
      dimension: dim,
      label: LABELS[dim],
      score: scores[dim] ?? 0,
      text: TEXTS[dim],
    }));
    const sorted = [...details].sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, sorted[1].score >= sorted[0].score - 10 ? 2 : 1);
    const label = top.map((t) => t.label).join(" + ");
    return {
      label,
      summary: `你的主要风格是${label}（${top.map((t) => t.score).join("、")} 分）。四种风格没有优劣之分，了解自己的倾向能帮你判断哪类岗位、团队氛围更适合你。`,
      details,
    };
  },
};
