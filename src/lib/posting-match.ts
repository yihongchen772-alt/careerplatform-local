export type ProfileMatchSignal = {
  hasSignal: boolean;
  baseTrackTerms: string[];
  trackTerms: string[];
  cities: string[];
  skillTerms: string[];
  graduationYear: string | null;
  degree: string | null;
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
  [/运动控制|机器人|具身|控制算法|plc|伺服|自动驾驶|slam/i, ["运动控制", "控制算法", "机器人", "具身智能", "plc", "伺服", "ethercat", "mpc", "pid", "slam", "ros", "ros2", "自动驾驶", "simulink", "c++"]],
  [/硬件|pcb|射频|电路|电源|结构/i, ["硬件", "pcb", "电路", "模电", "数电", "射频", "电源", "原理图", "altium", "cadence", "solidworks", "ansys"]],
  [/算法|ai|大模型|llm|机器学习|深度学习|nlp|cv/i, ["算法", "ai", "大模型", "llm", "机器学习", "深度学习", "nlp", "cv", "推荐", "pytorch", "cuda", "agent", "rag", "vla"]],
  [/数据|分析|数仓|bi\b|sql/i, ["数据", "数据分析", "数仓", "sql", "bi", "大数据", "spark", "hive"]],
  [/产品|pm\b|运营/i, ["产品", "产品经理", "ai产品", "b端", "c端", "需求", "策略", "增长"]],
  [/测试|测开|qa\b|质量/i, ["测试", "测开", "测试开发", "自动化测试", "质量保障", "qa"]],
  [/运维|sre|devops|云原生|安全/i, ["运维", "sre", "devops", "k8s", "docker", "云原生", "安全"]],
  [/ic|芯片|数字前端|数字后端|验证|soc/i, ["ic", "芯片", "数字", "verilog", "uvm", "验证", "soc", "asic", "rtl"]],
];

const RESUME_TECH_TOKENS = [
  "java", "python", "c++", "c语言", "golang", "rust", "typescript", "javascript", "react", "vue", "nextjs",
  "stm32", "rtos", "freertos", "linux", "fpga", "verilog", "pcb", "altium", "ros", "ros2",
  "matlab", "simulink", "solidworks", "ansys", "can", "spi", "i2c", "ethercat", "plc", "slam", "mpc", "pid",
  "cuda", "tensorrt", "pytorch", "llm", "rag", "agent", "vla",
  "sql", "mysql", "postgresql", "redis", "docker", "kubernetes", "k8s",
  "大模型", "具身智能", "运动控制", "机器人", "嵌入式", "硬件", "前端", "后端", "算法", "产品", "数据分析", "测试",
];

const ASCII_TERM_REGEX_CACHE = new Map<string, RegExp>();

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getAsciiTermRegex(term: string): RegExp {
  let cached = ASCII_TERM_REGEX_CACHE.get(term);
  if (!cached) {
    cached = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term)}(?:$|[^a-z0-9])`, "i");
    if (ASCII_TERM_REGEX_CACHE.size > 500) ASCII_TERM_REGEX_CACHE.clear();
    ASCII_TERM_REGEX_CACHE.set(term, cached);
  }
  return cached;
}

function hasTerm(haystack: string, rawTerm: string): boolean {
  const term = rawTerm.trim().toLowerCase();
  if (!term) return false;
  if (/^[a-z0-9.+#_-]+$/i.test(term)) {
    return getAsciiTermRegex(term).test(haystack);
  }
  return haystack.includes(term);
}

export function resumeStructuredText(structured: unknown): string {
  if (!structured || typeof structured !== "object") return "";
  const doc = structured as {
    headline?: unknown;
    sections?: Array<{
      heading?: unknown;
      items?: Array<{ text?: unknown }>;
      entries?: Array<{
        title?: unknown;
        subtitle?: unknown;
        tags?: unknown;
        lines?: Array<{ text?: unknown }>;
        bullets?: Array<{ text?: unknown }>;
      }>;
    }>;
  };
  const chunks: string[] = [];
  if (typeof doc.headline === "string" && doc.headline.trim()) chunks.push(doc.headline.trim());
  if (Array.isArray(doc.sections)) {
    for (const sec of doc.sections) {
      if (typeof sec?.heading === "string" && sec.heading.trim()) chunks.push(sec.heading.trim());
      if (Array.isArray(sec?.items)) {
        for (const item of sec.items) if (typeof item?.text === "string" && item.text.trim()) chunks.push(item.text.trim());
      }
      if (Array.isArray(sec?.entries)) {
        for (const entry of sec.entries) {
          for (const v of [entry?.title, entry?.subtitle, entry?.tags]) {
            if (typeof v === "string" && v.trim()) chunks.push(v.trim());
            else if (Array.isArray(v)) {
              const joined = v.filter((t): t is string => typeof t === "string" && !!t.trim()).join(" ");
              if (joined) chunks.push(joined);
            }
          }
          for (const row of [...(entry?.lines ?? []), ...(entry?.bullets ?? [])]) {
            if (typeof row?.text === "string" && row.text.trim()) chunks.push(row.text.trim());
          }
        }
      }
    }
  }
  return chunks.join("\n");
}

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
    degree?: string | null;
  } | null,
  resumeText?: string | null,
  resumeStructured?: unknown
): ProfileMatchSignal {
  const baseTracks = splitTerms(user?.targetTrack);
  const baseTrackTerms = baseTracks.map((t) => t.toLowerCase());
  const trackSet = new Set(baseTrackTerms);
  const trackSource = baseTracks.join(" ");
  for (const [pattern, synonyms] of SYNONYM_GROUPS) {
    if (pattern.test(trackSource)) {
      for (const word of synonyms) trackSet.add(word.toLowerCase());
    }
  }

  const cities = splitTerms(user?.preferredCities).map((c) => c.replace(/[市省区]$/, ""));
  const skillSet = new Set(splitTerms(user?.skills).map((s) => s.toLowerCase()));
  const effectiveText = (resumeText && resumeText.trim()) || resumeStructuredText(resumeStructured);
  if (effectiveText) {
    const lowerResume = effectiveText.toLowerCase();
    for (const token of RESUME_TECH_TOKENS) {
      if (hasTerm(lowerResume, token)) skillSet.add(token.toLowerCase());
    }
  }

  const graduationYear = user?.graduationYear ? String(user.graduationYear) : null;
  const degree = user?.degree?.trim() || null;
  const trackTerms = [...trackSet];
  const skillTerms = [...skillSet].filter((s) => !trackSet.has(s)).slice(0, 18);

  return {
    hasSignal: trackTerms.length > 0 || cities.length > 0 || skillTerms.length > 0 || !!graduationYear,
    baseTrackTerms,
    trackTerms,
    cities,
    skillTerms,
    graduationYear,
    degree,
  };
}

function degreeRank(raw: string | null | undefined): number {
  if (!raw) return 0;
  if (/博士|phd/i.test(raw)) return 3;
  if (/硕士|研究生|master/i.test(raw)) return 2;
  if (/本科|学士|统招|bachelor/i.test(raw)) return 1;
  return 0;
}

function evaluatePostingScore(
  item: {
    companyName?: string | null;
    title?: string | null;
    tracks?: string | null;
    cities?: string | null;
    industry?: string | null;
    graduation?: string | null;
    degree?: string | null;
    description?: string | null;
  },
  signal: ProfileMatchSignal,
  withReasons: boolean
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
    let baseCount = 0;
    let firstBaseHit = "";
    for (const t of signal.baseTrackTerms) {
      if (hasTerm(directionText, t)) {
        baseCount += 1;
        if (!firstBaseHit) firstBaseHit = t;
      }
    }
    let synCount = 0;
    let firstSynHit = "";
    for (const t of signal.trackTerms) {
      if (!signal.baseTrackTerms.includes(t) && hasTerm(directionText, t)) {
        synCount += 1;
        if (!firstSynHit) firstSynHit = t;
      }
    }
    if (baseCount > 0 || synCount > 0) {
      const weightedHits = baseCount * 1.5 + Math.min(3, synCount) * 0.7;
      const ratio = Math.min(1, weightedHits / Math.min(2.5, Math.max(1.5, signal.baseTrackTerms.length * 1.5)));
      earned += Math.round(30 + ratio * 20);
      if (withReasons) reasons.push(`方向命中:${firstBaseHit || firstSynHit}`);
    }
  }

  if (signal.cities.length > 0) {
    maxPossible += 25;
    let hitCity = "";
    for (const c of signal.cities) {
      if (cityText.includes(c.toLowerCase())) {
        hitCity = c;
        break;
      }
    }
    if (hitCity) {
      earned += 25;
      if (withReasons) reasons.push(`城市:${hitCity}`);
    } else if (/全国|不限|多地|remote/i.test(cityText)) {
      earned += 14;
      if (withReasons) reasons.push("多地可选");
    }
  }

  if (signal.skillTerms.length > 0) {
    maxPossible += 15;
    let skillCount = 0;
    let firstSkill = "";
    for (const t of signal.skillTerms) {
      if (hasTerm(directionText, t)) {
        skillCount += 1;
        if (!firstSkill) firstSkill = t;
      }
    }
    if (skillCount > 0) {
      earned += Math.min(15, skillCount * 6);
      if (withReasons) reasons.push(`技能:${firstSkill}`);
    }
  }

  if (signal.graduationYear) {
    maxPossible += 10;
    const mentionedYears = gradText.match(/20\d{2}/g);
    if (!mentionedYears || mentionedYears.includes(signal.graduationYear) || /不限|应届/.test(gradText)) {
      if (mentionedYears?.includes(signal.graduationYear)) {
        earned += 10;
        if (withReasons) reasons.push(`${signal.graduationYear}届`);
      } else {
        earned += 5;
      }
    } else {
      earned = Math.max(0, earned - 25);
    }
  }

  const userDeg = degreeRank(signal.degree);
  const reqDeg = degreeRank(item.degree);
  if (userDeg > 0 && reqDeg > userDeg) {
    earned = Math.max(0, earned - (reqDeg - userDeg) * 15);
  }

  const normalized = maxPossible > 0 ? Math.max(0, Math.min(100, Math.round((earned / maxPossible) * 100))) : 0;
  const tier = normalized >= 70 ? "high" : normalized >= 40 ? "medium" : "low";
  return { score: normalized, tier, reasons: withReasons ? reasons.slice(0, 3) : [] };
}

export function scorePostingMatch(
  item: {
    companyName?: string | null;
    title?: string | null;
    tracks?: string | null;
    cities?: string | null;
    industry?: string | null;
    graduation?: string | null;
    degree?: string | null;
    description?: string | null;
  },
  signal: ProfileMatchSignal
): PostingMatchResult {
  return evaluatePostingScore(item, signal, true);
}

/** Fast numeric-only match scorer for bulk ranking thousands of postings without allocating reason arrays. */
export function scorePostingNumeric(
  item: {
    companyName?: string | null;
    title?: string | null;
    tracks?: string | null;
    cities?: string | null;
    industry?: string | null;
    graduation?: string | null;
    degree?: string | null;
    description?: string | null;
  },
  signal: ProfileMatchSignal
): number {
  return evaluatePostingScore(item, signal, false).score;
}
