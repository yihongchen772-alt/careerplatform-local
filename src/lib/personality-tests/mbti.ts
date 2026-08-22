import { averageByDimension, type TestDefinition, type TestItem } from "./types";

// Self-authored items inspired by the public four-dichotomy structure behind
// MBTI-style typing (E/I, S/N, T/F, J/P) — NOT the official Myers-Briggs
// instrument, which is a trademarked, copyrighted assessment we don't have
// rights to reproduce. Each item is phrased toward one pole; the score is a
// 0-100 position on that axis, not a pass/fail trait.
const items: TestItem[] = [
  { id: "ei1", dimension: "EI", text: "参加聚会或活动后，我感觉更有精神而不是更累" },
  { id: "ei2", dimension: "EI", text: "遇到问题，我更习惯先说出来跟人讨论，再理清思路" },
  { id: "ei3", dimension: "EI", text: "我认识的人比较多，也乐于认识新朋友" },
  { id: "ei4", dimension: "EI", text: "在小组里，我常常是主动开口、带节奏的那个" },
  { id: "ei5", dimension: "EI", text: "长时间独处会让我觉得有点无聊，想找人聊聊" },

  { id: "sn1", dimension: "SN", text: "我更关注实际、具体的细节，而不是背后的大方向" },
  { id: "sn2", dimension: "SN", text: "做事时我倾向按已经验证过的方法来，而不是自己琢磨新招" },
  { id: "sn3", dimension: "SN", text: "我更相信亲眼看到、摸得着的事实，而不是直觉和联想" },
  { id: "sn4", dimension: "SN", text: "描述一件事时，我会先讲具体发生了什么，而不是先讲整体感受" },
  { id: "sn5", dimension: "SN", text: "比起畅想未来的可能性，我更关心眼前能不能落地" },

  { id: "tf1", dimension: "TF", text: "做决定时，我更看重逻辑和是否合理，而不是会不会伤感情" },
  { id: "tf2", dimension: "TF", text: "指出别人的问题时，我更在意说得对不对，而不是听着舒不舒服" },
  { id: "tf3", dimension: "TF", text: "评价一件事，我倾向用客观标准，而不是当时的心情氛围" },
  { id: "tf4", dimension: "TF", text: "跟人产生分歧，我更想先弄清楚谁的道理站得住" },
  { id: "tf5", dimension: "TF", text: "我做选择时，会有意识地把个人情绪放在后面" },

  { id: "jp1", dimension: "JP", text: "我喜欢提前定好计划，并且按计划走" },
  { id: "jp2", dimension: "JP", text: "任务没有明确截止日期，我也会给自己定一个" },
  { id: "jp3", dimension: "JP", text: "临时改变安排会让我觉得不舒服，需要一点时间适应" },
  { id: "jp4", dimension: "JP", text: "我倾向早点把事情定下来，而不是留着到最后再看情况" },
  { id: "jp5", dimension: "JP", text: "东西/日程我喜欢整理得井井有条，而不是随性而为" },
];

const TYPE_TEXT: Record<string, { high: string; low: string }> = {
  EI: { high: "E 外向", low: "I 内向" },
  SN: { high: "S 实感", low: "N 直觉" },
  TF: { high: "T 思考", low: "F 情感" },
  JP: { high: "J 判断", low: "P 感知" },
};

const DIM_DESCRIPTIONS: Record<string, string> = {
  EI: "能量来源：外部互动（E）还是内在独处（I）",
  SN: "接收信息的方式：具体细节（S）还是整体直觉（N）",
  TF: "做决定的依据：逻辑分析（T）还是人际情感（F）",
  JP: "面对计划的态度：喜欢定下来（J）还是保持灵活（P）",
};

function letterOf(dim: string, score: number): string {
  return score >= 50 ? TYPE_TEXT[dim].high[0] : TYPE_TEXT[dim].low[0];
}

export const mbtiTest: TestDefinition = {
  id: "MBTI",
  title: "性格类型测试（MBTI 参考版）",
  subtitle: "基于四组维度的自测，非官方 MBTI 测评，仅供个人参考",
  dimensions: [
    { key: "EI", label: "外向 / 内向", description: DIM_DESCRIPTIONS.EI },
    { key: "SN", label: "实感 / 直觉", description: DIM_DESCRIPTIONS.SN },
    { key: "TF", label: "思考 / 情感", description: DIM_DESCRIPTIONS.TF },
    { key: "JP", label: "判断 / 感知", description: DIM_DESCRIPTIONS.JP },
  ],
  items,
  scale: { min: 1, max: 5, minLabel: "很不符合", maxLabel: "很符合" },
  score: (answers) => averageByDimension(items, answers),
  interpret: (scores) => {
    const dims = ["EI", "SN", "TF", "JP"];
    const type = dims.map((d) => letterOf(d, scores[d] ?? 50)).join("");
    const details = dims.map((dim) => {
      const score = scores[dim] ?? 50;
      const pole = score >= 50 ? TYPE_TEXT[dim].high : TYPE_TEXT[dim].low;
      const distanceFromMid = Math.abs(score - 50);
      const strength = distanceFromMid >= 25 ? "倾向明显" : distanceFromMid >= 10 ? "有一定倾向" : "两边都比较平衡";
      return {
        dimension: dim,
        label: pole,
        score,
        text: `${strength}（${score} / 100，50 为中间值）。`,
      };
    });
    return {
      label: type,
      summary: `参考类型：${type}。这是基于自我评价的简化测试，不是严谨的心理测评，结果供求职时了解自己风格参考，不建议作为唯一依据做重大决定。`,
      details,
    };
  },
};
