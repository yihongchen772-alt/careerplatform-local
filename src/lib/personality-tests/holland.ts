import { averageByDimension, type TestDefinition, type TestItem } from "./types";

// Self-authored items inspired by Holland's public RIASEC theory of
// vocational interest types — not a reproduction of any specific commercial
// or government instrument (e.g. the Self-Directed Search or O*NET
// Interest Profiler), just the same six-category structure.
const items: TestItem[] = [
  { id: "r1", dimension: "R", text: "比起讨论方案，我更喜欢动手把东西做/修出来" },
  { id: "r2", dimension: "R", text: "我对机械、工具、设备类的东西比较感兴趣" },
  { id: "r3", dimension: "R", text: "户外或体力相关的活动我不排斥，甚至挺喜欢" },
  { id: "r4", dimension: "R", text: "比起纯理论，我更想知道这东西具体怎么运作" },

  { id: "i1", dimension: "I", text: "我喜欢琢磨一个问题为什么会是这样、背后的原理是什么" },
  { id: "i2", dimension: "I", text: "做研究、查资料、验证一个想法对我来说是件有意思的事" },
  { id: "i3", dimension: "I", text: "面对复杂问题，我愿意花时间深入分析而不是马上下结论" },
  { id: "i4", dimension: "I", text: "我对数据、实验、逻辑推理类的内容比较感兴趣" },

  { id: "a1", dimension: "A", text: "我喜欢用自己的方式表达想法，不太愿意被固定格式束缚" },
  { id: "a2", dimension: "A", text: "设计、写作、音乐这类创作性的事对我有吸引力" },
  { id: "a3", dimension: "A", text: "我经常会有一些别人没想到的点子" },
  { id: "a4", dimension: "A", text: "比起标准答案，我更享受自由发挥的空间" },

  { id: "s1", dimension: "S", text: "帮助别人解决问题会让我有成就感" },
  { id: "s2", dimension: "S", text: "我愿意花时间倾听别人、了解他们的需要" },
  { id: "s3", dimension: "S", text: "教别人东西、看到对方学会了，我会很有满足感" },
  { id: "s4", dimension: "S", text: "团队里我常常是照顾大家感受的那个人" },

  { id: "e1", dimension: "E", text: "我喜欢说服别人接受我的想法或方案" },
  { id: "e2", dimension: "E", text: "带领一个项目/团队往前推进，我会觉得有动力" },
  { id: "e3", dimension: "E", text: "谈判、销售、拉资源这类事我不排斥，甚至擅长" },
  { id: "e4", dimension: "E", text: "我对做出成绩、被人认可这件事比较看重" },

  { id: "c1", dimension: "C", text: "我喜欢把信息、数据整理得清清楚楚" },
  { id: "c2", dimension: "C", text: "按流程、按规范做事让我觉得安心" },
  { id: "c3", dimension: "C", text: "处理表格、账目、文档这类细致的工作我不觉得枯燥" },
  { id: "c4", dimension: "C", text: "我做事比较严谨，喜欢核对清楚再交出去" },
];

const LABELS: Record<string, string> = {
  R: "现实型（R）",
  I: "研究型（I）",
  A: "艺术型（A）",
  S: "社会型（S）",
  E: "企业型（E）",
  C: "常规型（C）",
};

const TEXTS: Record<string, string> = {
  R: "偏好动手、实操类的工作，适合硬件、制造、运维、现场类岗位——喜欢把东西真正做出来、修好、跑起来的感觉。",
  I: "偏好研究、分析类的工作，适合技术研发、数据分析、算法、科研类岗位——享受钻研问题本身的过程。",
  A: "偏好创作、表达类的工作，适合设计、内容、产品创意类岗位——重视自由发挥的空间，不喜欢被框死。",
  S: "偏好帮助、教育、服务类的工作，适合HR、教育、咨询、客户成功类岗位——从帮到别人这件事里获得满足感。",
  E: "偏好带领、说服、拓展类的工作，适合销售、市场、创业、管理类岗位——享受推动事情往前走、拿结果的过程。",
  C: "偏好规范、细致、有条理的工作，适合财务、运营、质量、行政类岗位——把复杂信息整理清楚是你的强项。",
};

export const hollandTest: TestDefinition = {
  id: "HOLLAND",
  title: "职业兴趣测试（霍兰德 RIASEC 参考版）",
  subtitle: "六种兴趣类型看你适合什么方向的工作，自测参考版",
  dimensions: [
    { key: "R", label: "现实型", description: "喜欢动手、实操、具体的事物" },
    { key: "I", label: "研究型", description: "喜欢分析、研究、探索原理" },
    { key: "A", label: "艺术型", description: "喜欢创作、自由表达" },
    { key: "S", label: "社会型", description: "喜欢帮助、教育、服务他人" },
    { key: "E", label: "企业型", description: "喜欢带领、说服、拓展业务" },
    { key: "C", label: "常规型", description: "喜欢规范、细致、有条理的工作" },
  ],
  items,
  scale: { min: 1, max: 5, minLabel: "很不感兴趣", maxLabel: "很感兴趣" },
  score: (answers) => averageByDimension(items, answers),
  interpret: (scores) => {
    const dims = ["R", "I", "A", "S", "E", "C"];
    const details = dims.map((dim) => ({
      dimension: dim,
      label: LABELS[dim],
      score: scores[dim] ?? 0,
      text: TEXTS[dim],
    }));
    const top3 = [...details].sort((a, b) => b.score - a.score).slice(0, 3);
    const code = top3.map((t) => t.dimension).join("");
    return {
      label: code,
      summary: `你的兴趣代码是 ${code}（最突出的三个方向：${top3.map((t) => t.label).join("、")}）。霍兰德理论认为工作和兴趣类型越匹配，满意度和留任意愿通常越高，找工作时可以优先看这几个方向。`,
      details,
    };
  },
};
