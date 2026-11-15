import { siteKey } from "@/lib/site-key";

export type SetupRecommendation = {
  resumeVersionId?: string;
  resumeName?: string;
  variantId?: string;
  variantName?: string;
  reason: string;
};

export type EligibilityWarning = {
  kind: "graduation" | "degree" | "quota" | "duplicate";
  message: string;
};

const DOMAIN_CLUSTERS: { label: string; tokens: RegExp }[] = [
  { label: "具身智能 / 机器人", tokens: /具身|机器人|embodied|robot|ros2?|slam|运动控制|机械臂|灵巧手|vla|gazebo|isaac/i },
  { label: "大模型 / 算法", tokens: /大模型|llm|算法|transformer|pytorch|多模态|vlm|强化学习|rl|深度学习|nlp|cv|视觉|语音|推荐|搜索|ads/i },
  { label: "后端 / 基础架构", tokens: /后端|服务端|架构|golang|\bgo\b|java|c\+\+|rust|分布式|微服务|高并发|k8s|kubernetes|数据库|中间件/i },
  { label: "前端 / 客户端", tokens: /前端|web|react|vue|typescript|next\.js|ios|android|flutter|客户端|鸿蒙/i },
  { label: "嵌入式 / 硬件", tokens: /嵌入式|fpga|单片机|rtos|stm32|驱动|硬件|pcb|电源|电路|电机控制/i },
  { label: "芯片 / IC", tokens: /\bic\b|芯片|数字前端|数字验证|verilog|systemverilog|soc|模拟设计|dft/i },
  { label: "数据分析 / 数开", tokens: /数据分析|商业分析|数据科学|数仓|flink|spark|sql|bi|指标/i },
  { label: "产品 / 运营", tokens: /产品经理|ai产品|商业化|用户增长|运营|策略产品/i },
  { label: "自动驾驶 / 车规", tokens: /自动驾驶|智驾|感知|规控|planning|control|adas|座舱/i },
  { label: "金融 / 量化 / 管培", tokens: /量化|交易|投行|行研|财务|审计|管培/i },
];

const DEGREE_RANK: { label: string; rank: number; pattern: RegExp }[] = [
  { label: "博士", rank: 4, pattern: /博士|phd/i },
  { label: "硕士", rank: 3, pattern: /硕士|研究生|master/i },
  { label: "本科", rank: 2, pattern: /本科|学士|bachelor/i },
  { label: "大专", rank: 1, pattern: /大专|专科/i },
];

const CN_DIGIT: Record<string, number> = { "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5 };

function normalizeText(value: string | null | undefined): string {
  return String(value || "").normalize("NFKC").toLowerCase().trim();
}

function scoreTextOverlap(jdText: string, candidateText: string): { score: number; hitLabels: string[] } {
  if (!jdText || !candidateText) return { score: 0, hitLabels: [] };
  let score = 0;
  const hitLabels: string[] = [];
  for (const cluster of DOMAIN_CLUSTERS) {
    if (cluster.tokens.test(jdText) && cluster.tokens.test(candidateText)) {
      score += 3;
      hitLabels.push(cluster.label);
    }
  }
  const normalizedJd = normalizeText(jdText);
  const words = normalizeText(candidateText)
    .split(/[^a-z0-9\u4e00-\u9fa5+.#-]+/)
    .filter((w) => w.length >= 2 && !/^(简历|版本|默认|方案|网申|pdf|docx?|20\d{2}|校招|秋招|春招)$/.test(w));
  const seenWords = new Set<string>();
  for (const word of words) {
    if (seenWords.has(word)) continue;
    seenWords.add(word);
    if (normalizedJd.includes(word)) score += 1;
  }
  return { score, hitLabels };
}

export function recommendSetupForPage(input: {
  url: string | null;
  pageText?: string | null;
  jdTitle?: string | null;
  jdText?: string | null;
  tailoredResumes: { resumeVersionId: string; name: string; label: string; site: string }[];
  resumeVersions: { id: string; name: string; isDefault: boolean; digest?: string | null }[];
  profileVariants: { id: string; name: string; resumeVersionId: string | null }[];
  currentResumeVersionId: string;
  currentVariantChoice: string;
}): SetupRecommendation | null {
  const hostSite = input.url ? siteKey(input.url) : null;
  const tailoredHere = hostSite
    ? input.tailoredResumes.find((t) => t.site === hostSite && input.resumeVersions.some((r) => r.id === t.resumeVersionId))
    : undefined;
  if (tailoredHere) {
    const linkedVariant = input.profileVariants.find((v) => v.resumeVersionId === tailoredHere.resumeVersionId);
    const needResumeSwitch = tailoredHere.resumeVersionId !== input.currentResumeVersionId;
    const needVariantSwitch = !!linkedVariant && input.currentVariantChoice !== linkedVariant.id;
    if (needResumeSwitch || needVariantSwitch) {
      return {
        ...(needResumeSwitch ? { resumeVersionId: tailoredHere.resumeVersionId, resumeName: tailoredHere.name } : {}),
        ...(needVariantSwitch && linkedVariant ? { variantId: linkedVariant.id, variantName: linkedVariant.name } : {}),
        reason: `本站岗位「${tailoredHere.label}」有定制简历`,
      };
    }
    return null;
  }

  const jdHaystack = [input.jdTitle, input.jdText, input.pageText?.slice(0, 2000)].filter(Boolean).join("\n");
  if (!jdHaystack.trim() || (input.resumeVersions.length < 2 && input.profileVariants.length === 0)) return null;

  let bestResume: { id: string; name: string; score: number; labels: string[] } | null = null;
  let currentResumeScore = 0;
  if (input.resumeVersions.length >= 2) {
    for (const rv of input.resumeVersions) {
      const { score, hitLabels } = scoreTextOverlap(jdHaystack, `${rv.name} ${rv.digest || ""}`);
      if (rv.id === input.currentResumeVersionId) currentResumeScore = score;
      if (!bestResume || score > bestResume.score) {
        bestResume = { id: rv.id, name: rv.name, score, labels: hitLabels };
      }
    }
  }

  let bestVariant: { id: string; name: string; score: number; labels: string[] } | null = null;
  let currentVariantScore = 0;
  for (const variant of input.profileVariants) {
    const { score, hitLabels } = scoreTextOverlap(jdHaystack, variant.name);
    if (variant.id === input.currentVariantChoice) currentVariantScore = score;
    if (!bestVariant || score > bestVariant.score) {
      bestVariant = { id: variant.id, name: variant.name, score, labels: hitLabels };
    }
  }

  const switchResume =
    bestResume &&
    bestResume.id !== input.currentResumeVersionId &&
    bestResume.score >= 3 &&
    bestResume.score - currentResumeScore >= 2;
  const switchVariant =
    bestVariant &&
    bestVariant.id !== input.currentVariantChoice &&
    bestVariant.score >= 3 &&
    bestVariant.score - currentVariantScore >= 2;

  if (!switchResume && !switchVariant) return null;
  const labels = [...new Set([...(switchResume ? bestResume!.labels : []), ...(switchVariant ? bestVariant!.labels : [])])].slice(0, 2);
  return {
    ...(switchResume ? { resumeVersionId: bestResume!.id, resumeName: bestResume!.name } : {}),
    ...(switchVariant ? { variantId: bestVariant!.id, variantName: bestVariant!.name } : {}),
    reason: labels.length ? `当前岗位更偏向「${labels.join(" / ")}」方向` : "名称与当前岗位 JD 关键词更匹配",
  };
}

function degreeRankOf(raw: string | null | undefined): number {
  const s = String(raw || "");
  for (const row of DEGREE_RANK) {
    if (row.pattern.test(s)) return row.rank;
  }
  return 0;
}

export function analyzeEligibilityAndQuota(input: {
  profile: { graduationYear?: number | null; degree?: string | null };
  companyName?: string | null;
  applications: { id: string; companyName: string; title: string; stage: string; terminal?: boolean }[];
  position?: { title: string; companyName: string; jdText?: string | null; applicationRules?: string | null } | null;
  jdPage?: { title?: string; text?: string } | null;
  pageText?: string | null;
}): { warnings: EligibilityWarning[] } {
  const warnings: EligibilityWarning[] = [];
  const jdBody = [input.position?.applicationRules, input.position?.jdText, input.jdPage?.text, input.pageText?.slice(0, 3500)]
    .filter(Boolean)
    .join("\n");
  if (!jdBody.trim()) return { warnings };

  // 1. Graduation cohort (校招届别) check
  if (input.profile.graduationYear && !/社招|社会招聘/.test(jdBody.slice(0, 800))) {
    const years = new Set<number>();
    for (const m of jdBody.matchAll(/(20\d{2})\s*届|届别[：:\s]*(20\d{2})/g)) {
      const yr = Number(m[1] || m[2]);
      if (yr >= 2020 && yr <= 2035) years.add(yr);
    }
    if (years.size >= 1 && years.size <= 3 && !years.has(input.profile.graduationYear)) {
      const sorted = [...years].sort((a, b) => a - b).map((y) => `${y}届`).join(" / ");
      warnings.push({
        kind: "graduation",
        message: `届别核对：页面/JD 标注面向「${sorted}」，你资料里的毕业年份为 ${input.profile.graduationYear} 届`,
      });
    }
  }

  // 2. Minimum degree floor check
  const userRank = degreeRankOf(input.profile.degree);
  if (userRank > 0) {
    let minRank = 0;
    let floorLabel = "";
    if (/仅限博士|博士(?:研究生|学历)?及以上|博士学历要求|需博士学位/.test(jdBody)) {
      minRank = 4;
      floorLabel = "博士及以上";
    } else if (/硕士(?:研究生|学历)?及以上|研究生及以上|仅限硕士|限硕士|需硕士/.test(jdBody)) {
      minRank = 3;
      floorLabel = "硕士及以上";
    } else if (/本科(?:学历|学位)?及以上|仅限本科|限本科/.test(jdBody)) {
      minRank = 2;
      floorLabel = "本科及以上";
    }
    if (minRank > userRank) {
      warnings.push({
        kind: "degree",
        message: `学历门槛：页面/JD 标注「${floorLabel}」，你当前资料为「${input.profile.degree}」`,
      });
    }
  }

  // 3. Company quota & duplicate role check
  const targetCompany = normalizeText(input.position?.companyName || input.companyName);
  if (targetCompany.length >= 2) {
    const activeAtCompany = input.applications.filter((app) => {
      if (app.terminal) return false;
      const appCo = normalizeText(app.companyName);
      return appCo === targetCompany || (appCo.length >= 2 && (targetCompany.includes(appCo) || appCo.includes(targetCompany)));
    });
    const quotaMatch = /(?:最多|每人?最多|至多|只可|限(?:定|制)?)\s*(?:同时)?\s*(?:可?投递?|申请|选择|报)\s*([1-5一二两三四五])\s*个?(?:职位|岗位|志愿)?/.exec(jdBody);
    const limit = quotaMatch ? (Number(quotaMatch[1]) || CN_DIGIT[quotaMatch[1]] || 0) : 0;
    if (limit > 0 && activeAtCompany.length >= limit) {
      warnings.push({
        kind: "quota",
        message: `投递限额：标注每人最多投递 ${limit} 个岗位，你目前在「${input.position?.companyName || input.companyName}」已有 ${activeAtCompany.length} 条进行中投递`,
      });
    }
    const targetTitle = normalizeText(input.position?.title || input.jdPage?.title);
    if (targetTitle.length >= 3) {
      const sameRole = activeAtCompany.find((app) => {
        const appTitle = normalizeText(app.title);
        return appTitle.length >= 3 && (appTitle === targetTitle || appTitle.includes(targetTitle) || targetTitle.includes(appTitle));
      });
      if (sameRole) {
        warnings.push({
          kind: "duplicate",
          message: `岗位重合：你已有进行中的相同/相近投递「${sameRole.title}」（当前阶段：${sameRole.stage}）`,
        });
      }
    }
  }

  return { warnings };
}
