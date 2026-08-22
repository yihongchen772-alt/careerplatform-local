import { averageByDimension, type TestDefinition, type TestItem } from "./types";

// Self-authored items inspired by the public Five-Factor Model structure
// (openness / conscientiousness / extraversion / agreeableness / neuroticism)
// — not a reproduction of the IPIP, BFI, or any other specific instrument.
const items: TestItem[] = [
  { id: "o1", dimension: "O", text: "我喜欢接触新想法、新领域，即使和我现在做的事没什么关系" },
  { id: "o2", dimension: "O", text: "比起按部就班，我更喜欢琢磨有没有更巧妙的做法" },
  { id: "o3", dimension: "O", text: "我经常会对一些抽象的、理论性的话题感兴趣" },
  { id: "o4", dimension: "O", text: "我不太喜欢尝试没做过的事，更愿意用熟悉的方式", reverse: true },
  { id: "o5", dimension: "O", text: "我喜欢的话题和爱好比较杂，涉猎面挺广" },

  { id: "c1", dimension: "C", text: "开始一件事之前，我会先列好计划再动手" },
  { id: "c2", dimension: "C", text: "我做事情比较有条理，东西/资料会分类整理" },
  { id: "c3", dimension: "C", text: "定下的截止日期，我基本都能按时完成" },
  { id: "c4", dimension: "C", text: "我常常拖到最后一刻才开始做该做的事", reverse: true },
  { id: "c5", dimension: "C", text: "做完一件事之前，我很难放下不管去做别的" },

  { id: "e1", dimension: "E", text: "和一群人在一起会让我感觉更有活力" },
  { id: "e2", dimension: "E", text: "在不太熟的场合，我也能比较自然地开口说话" },
  { id: "e3", dimension: "E", text: "长时间一个人待着，我会觉得有点闷" },
  { id: "e4", dimension: "E", text: "比起社交，我更享受独处、安静做自己的事", reverse: true },
  { id: "e5", dimension: "E", text: "我说话/表达的时候比较直接，情绪也容易被看出来" },

  { id: "a1", dimension: "A", text: "别人有困难找我帮忙，我一般都会尽量搭把手" },
  { id: "a2", dimension: "A", text: "和人有分歧时，我更倾向先照顾对方的感受" },
  { id: "a3", dimension: "A", text: "我比较容易相信别人，不会一开始就防备" },
  { id: "a4", dimension: "A", text: "我说话有时候比较直，不太顾及会不会伤到人", reverse: true },
  { id: "a5", dimension: "A", text: "团队合作里我更在意大家关系好，而不是争对错" },

  { id: "n1", dimension: "N", text: "遇到突发状况，我容易紧张、心里没底" },
  { id: "n2", dimension: "N", text: "一件没做好的事，我会反复想很久，不容易放下" },
  { id: "n3", dimension: "N", text: "压力大的时候，我的情绪会比较明显地受影响" },
  { id: "n4", dimension: "N", text: "遇到问题，我一般都能比较冷静地想办法，不太慌", reverse: true },
  { id: "n5", dimension: "N", text: "别人的一句无心的话，我可能会在意好一阵子" },
];

const LABELS: Record<string, string> = {
  O: "开放性",
  C: "尽责性",
  E: "外向性",
  A: "宜人性",
  N: "情绪稳定性",
};

// N is inverted for display — high raw "焦虑倾向" score means LOW emotional
// stability, and framing it as 情绪稳定性 (stability) reads more usefully
// than 神经质 (neuroticism) for a job-search self-reference tool.
function stabilityScore(neuroticismRaw: number): number {
  return 100 - neuroticismRaw;
}

function bandText(dim: string, score: number): string {
  const high = score >= 65;
  const low = score <= 35;
  const texts: Record<string, { high: string; mid: string; low: string }> = {
    O: {
      high: "对新想法、新领域接受度高，适合需要探索和创新的角色，但也要留意有没有把事情真正落地。",
      mid: "在熟悉和新鲜之间比较平衡，能接受变化，也能踏实做重复性的工作。",
      low: "更偏好确定和熟悉的方式，执行层面的稳定性是优势，遇到需要大量创新的岗位可能要多适应。",
    },
    C: {
      high: "自律、有条理，交付靠谱是明显的优势，求职时可以多举“按时高质量完成”的具体例子。",
      mid: "计划性中等，能完成任务但偶尔需要外部推动，找工作时可以练习更主动地拆解和跟进目标。",
      low: "灵活但容易拖延或缺乏条理，投递、准备面试这类需要持续跟进的事，建议借助清单/提醒工具。",
    },
    E: {
      high: "在人群里更有能量，适合需要频繁沟通、对外展示的岗位，面试时的表现力通常是加分项。",
      mid: "社交和独处都能应付，团队协作和独立工作岗位都能适应。",
      low: "更享受专注和独处，适合需要深度思考、少打扰的工作，面试前建议多做模拟练习来适应高强度社交场景。",
    },
    A: {
      high: "容易与人合作、照顾团队氛围，是很好的合作者，但也要注意在需要据理力争的场合别一味迁就。",
      mid: "合作和坚持自己立场之间比较平衡。",
      low: "更看重效率和对错、不轻易妥协，适合需要独立判断的岗位，团队协作时可以多留意别人的感受。",
    },
    N: {
      high: "情绪比较稳定，压力下不容易自乱阵脚，这在高压面试和工作场景里是明显优势。",
      mid: "情绪稳定性中等，大部分情况能应付，遇到重大压力事件建议提前有心理准备。",
      low: "容易因为压力、突发状况产生明显的情绪波动，面试前的呼吸/放松练习、多次模拟能有效缓解。",
    },
  };
  const t = texts[dim];
  return high ? t.high : low ? t.low : t.mid;
}

export const oceanTest: TestDefinition = {
  id: "OCEAN",
  title: "大五人格（OCEAN）",
  subtitle: "五个维度看你的行为风格倾向，自测参考版，不是学术量表",
  dimensions: [
    { key: "O", label: "开放性", description: "对新想法、新体验的接受程度" },
    { key: "C", label: "尽责性", description: "计划性、自律和执行力" },
    { key: "E", label: "外向性", description: "从社交互动中获得能量的程度" },
    { key: "A", label: "宜人性", description: "合作、体谅他人的倾向" },
    { key: "N", label: "情绪稳定性", description: "面对压力时情绪的稳定程度" },
  ],
  items,
  scale: { min: 1, max: 5, minLabel: "很不符合", maxLabel: "很符合" },
  score: (answers) => averageByDimension(items, answers),
  interpret: (scores) => {
    const display: Record<string, number> = {
      ...scores,
      N: stabilityScore(scores.N ?? 50),
    };
    const details = ["O", "C", "E", "A", "N"].map((dim) => ({
      dimension: dim,
      label: LABELS[dim],
      score: display[dim],
      text: bandText(dim, display[dim]),
    }));
    const top = [...details].sort((a, b) => b.score - a.score)[0];
    return {
      label: `${top.label}突出`,
      summary: `五个维度里，「${top.label}」相对最突出（${top.score} 分）。这不是好坏之分，是行为风格的参考，具体解读看下面每一项。`,
      details,
    };
  },
};
