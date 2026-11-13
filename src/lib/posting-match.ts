export type ProfileMatchSignal = {
  hasSignal: boolean;
  trackTerms: string[];
  cities: string[];
  skillTerms: string[];
  graduationYear: string | null;
};

export type PostingMatchResult = {
  score: number;
  tier: "high" | "medium" | "low";
  reasons: string[];
};

const SYNONYM_GROUPS: [RegExp, string[]][] = [
  [/前端|web|fe\b|h5/i, ["前端", "react", "vue", "typescript", "javascript", "nextjs", "h5", "web"]],
  [/后端|服务端|java|golang|go\b|c\+\+/i, ["后端", "服务端", "java", "go", "golang", "c++", "python", "微服务", "分布式"]],
  [/嵌入式|固件|单片机|mcu|rtos|驱动/i, ["嵌入式", "mcu", "rtos", "freertos", "stm32", "arm", "linux", "驱动", "固件", "单片机", "bsp", "c语言", "fpga"]],
  [/硬件|pcb|射频|电路|电源|结构/i, ["硬件", "pcb", "电路", "模电", "数电", "射频", "电源", "原理图", "altium", "cadence"]],
  [/算法|ai|大模型|llm|机器学习|深度学习|nlp|cv/i, ["算法", "ai", "大模型", "llm", "机器学习", "深度学习", "nlp", "cv", "推荐", "pytorch"]],
  [/数据|分析|数仓|bi\b|sql/i, ["数据", "数据分析", "数仓", "sql", "bi", "大数据", "spark", "hive"]],
  [/产品|pm\b|运营/i, ["产品", "产品经理", "ai产品", "b端", "c端", "需求", "策略", "增长"]],
  [/测试|测开|qa\b|质量/i, ["测试", "测开", "测试开发", "自动化测试", "质量保障", "qa"]],
  [/运维|sre|devops|云原生|安全/i, ["运维", "sre", "devops", "k8s", "docker", "云原生", "安全"]],
  [/ic|芯片|数字前端|数字后端|验证|soc/i, ["ic", "芯片", "数字", "verilog", "uvm", "验证", "soc", "asic", "rtl"]],
];

const RESUME_TECH_TOKENS = [
  "java", "python", "c++", "golang", "typescript", "javascript", "react", "vue",
  "stm32", "rtos", "freertos", "linux", "fpga", "verilog", "pcb", "altium",
  "sql", "mysql", "redis", "docker", "kubernetes", "k8s", "pytorch", "llm",
  "大模型", "嵌入式", "硬件", "前端", "后端", "算法", "产品", "数据分析", "测试",
];

function splitTerms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [...new Set(
    raw
      .split(/[\s,，、/;|；]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 || /^[a-z0-9]{2,}$/i.test(s))
  )];
}

export function extractProfileSignal(
  user: {
    targetTrack?: string | null;
    preferredCities?: string | null;
    skills?: string | null;
    graduationYear?: number | null;
  } | null,
  resumeText?: string | null
): ProfileMatchSignal {
  const baseTracks = splitTerms(user?.targetTrack);
  const trackSet = new Set(baseTracks.map((t) => t.toLowerCase()));
  const trackSource = baseTracks.join(" ");
  for (const [pattern, synonyms] of SYNONYM_GROUPS) {
    if (pattern.test(trackSource)) {
      for (const word of synonyms) trackSet.add(word.toLowerCase());
    }
  }

  const cities = splitTerms(user?.preferredCities).map((c) => c.replace(/[市省区]$/, ""));
  const skillSet = new Set(splitTerms(user?.skills).map((s) => s.toLowerCase()));
  if (resumeText) {
    const lowerResume = resumeText.toLowerCase();
    for (const token of RESUME_TECH_TOKENS) {
      if (lowerResume.includes(token.toLowerCase())) skillSet.add(token.toLowerCase());
    }
  }

  const graduationYear = user?.graduationYear ? String(user.graduationYear) : null;
  const trackTerms = [...trackSet];
  const skillTerms = [...skillSet].filter((s) => !trackSet.has(s)).slice(0, 16);

  return {
    hasSignal: trackTerms.length > 0 || cities.length > 0 || skillTerms.length > 0 || !!graduationYear,
    trackTerms,
    cities,
    skillTerms,
    graduationYear,
  };
}

export function scorePostingMatch(
  item: {
    companyName?: string | null;
    title?: string | null;
    tracks?: string | null;
    cities?: string | null;
    industry?: string | null;
    graduation?: string | null;
    description?: string | null;
  },
  signal: ProfileMatchSignal
): PostingMatchResult {
  if (!signal.hasSignal) return { score: 0, tier: "low", reasons: [] };

  const directionText = [item.title, item.tracks, item.industry, item.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const cityText = (item.cities || "").toLowerCase();
  const gradText = item.graduation || "";

  let earned = 0;
  let maxPossible = 0;
  const reasons: string[] = [];

  if (signal.trackTerms.length > 0) {
    maxPossible += 50;
    const hits = signal.trackTerms.filter((t) => directionText.includes(t));
    if (hits.length > 0) {
      const ratio = Math.min(1, hits.length / Math.min(3, signal.trackTerms.length));
      earned += Math.round(30 + ratio * 20);
      reasons.push(`方向命中:${hits[0]}`);
    }
  }

  if (signal.cities.length > 0) {
    maxPossible += 25;
    const hitCity = signal.cities.find((c) => cityText.includes(c.toLowerCase()));
    if (hitCity) {
      earned += 25;
      reasons.push(`城市:${hitCity}`);
    } else if (/全国|不限|多地|remote/i.test(cityText)) {
      earned += 14;
      reasons.push("多地可选");
    }
  }

  if (signal.skillTerms.length > 0) {
    maxPossible += 15;
    const skillHits = signal.skillTerms.filter((t) => directionText.includes(t));
    if (skillHits.length > 0) {
      earned += Math.min(15, skillHits.length * 6);
      reasons.push(`技能:${skillHits[0]}`);
    }
  }

  if (signal.graduationYear) {
    maxPossible += 10;
    const mentionedYears = gradText.match(/20\d{2}/g);
    if (!mentionedYears || mentionedYears.includes(signal.graduationYear) || /不限|应届/.test(gradText)) {
      if (mentionedYears?.includes(signal.graduationYear)) {
        earned += 10;
        reasons.push(`${signal.graduationYear}届`);
      } else {
        earned += 5;
      }
    } else {
      earned = Math.max(0, earned - 25);
    }
  }

  const normalized = maxPossible > 0 ? Math.max(0, Math.min(100, Math.round((earned / maxPossible) * 100))) : 0;
  const tier = normalized >= 70 ? "high" : normalized >= 40 ? "medium" : "low";
  return { score: normalized, tier, reasons: reasons.slice(0, 3) };
}
