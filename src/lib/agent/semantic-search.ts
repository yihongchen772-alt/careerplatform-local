/**
 * Lightweight local semantic expansion & relevance scoring for 小欧's search
 * tools (`search_records`, `recall_conversations`, `search_emails`).
 * Zero external API calls, offline-safe, sub-millisecond latency.
 */

const SYNONYM_GROUPS: string[][] = [
  ["具身智能", "人形机器人", "机器人", "robotics", "vla", "运控", "运动控制", "强化学习", "rl", "ros", "slam"],
  ["大模型", "llm", "aigc", "agent", "智能体", "多模态", "nlp", "rag", "推理加速", "微调", "sft"],
  ["自动驾驶", "智驾", "规控", "感知", "定位", "车企", "新能源汽车", "座舱", "adas"],
  ["后端", "服务端", "后台", "java", "go", "golang", "c++", "分布式", "微服务", "高并发", "数据库"],
  ["前端", "web", "react", "vue", "typescript", "javascript", "客户端", "ios", "android", "flutter"],
  ["算法", "机器学习", "深度学习", "ml", "dl", "推荐", "搜索", "广告", "cv", "计算机视觉", "图像"],
  ["芯片", "半导体", "ic", "数字前端", "数字后端", "嵌入式", "硬件", "固件", "fpga", "rtos", "mcu", "驱动"],
  ["产品经理", "pm", "策略产品", "ai产品", "数据分析", "商业分析", "ba", "运营", "增长"],
  ["央国企", "国企", "央企", "银行", "研究所", "军工", "事业单位", "选调", "电网", "运营商"],
  ["笔试", "测评", "oa", "机考", "在线测试", "行测", "性格测试", "编程题"],
  ["面试", "一面", "二面", "三面", "终面", "hr面", "群面", "无领导", "面经", "复盘"],
  ["offer", "录用", "薪资", "总包", "待遇", "谈薪", "argue", "期权", "签字费", "三方"],
  ["简历", "cv", "resume", "作品集", "自荐信", "求职信"],
  ["内推", "推荐人", "校招", "秋招", "春招", "暑期实习", "实习"],
  ["字节", "字节跳动", "bytedance", "抖音"],
  ["阿里", "阿里巴巴", "淘天", "阿里云", "蚂蚁"],
  ["腾讯", "tencent", "微信", "ieg", "wxg", "csig"],
  ["美团", "meituan", "点评"],
  ["华为", "huawei", "海思", "2012"],
  ["大疆", "dji"],
  ["宇树", "unitree", "智元", "agibot", "银河通用"],
];

const TERM_TO_GROUP = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  const lowerGroup = group.map((t) => t.toLowerCase());
  for (const term of lowerGroup) {
    const existing = TERM_TO_GROUP.get(term);
    if (existing) {
      for (const item of lowerGroup) if (!existing.includes(item)) existing.push(item);
    } else {
      TERM_TO_GROUP.set(term, [...lowerGroup]);
    }
  }
}

/** Splits a user query into meaningful tokens and expands each with domain synonyms. */
export function expandQueryTerms(query: string): string[][] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];
  const tokens = raw
    .split(/[\s,，、/|+]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
  if (!tokens.length) return [];

  return tokens.map((token) => {
    const expanded = new Set<string>([token]);
    const direct = TERM_TO_GROUP.get(token);
    if (direct) {
      for (const s of direct) expanded.add(s);
    } else if (token.length >= 2) {
      // Partial match against known domain terms (e.g. "机器人岗" hits "机器人")
      for (const [key, group] of TERM_TO_GROUP.entries()) {
        if (key.length >= 2 && (token.includes(key) || key.includes(token))) {
          for (const s of group) expanded.add(s);
          if (expanded.size >= 10) break;
        }
      }
    }
    return [...expanded];
  });
}

/** Flat bounded list of query keywords (original first, then synonyms) for SQL OR clauses. */
export function expandSqlTerms(query: string, maxTerms = 8): string[] {
  const raw = query.trim();
  if (!raw) return [];
  const out: string[] = [raw];
  const seen = new Set<string>([raw.toLowerCase()]);
  for (const group of expandQueryTerms(raw)) {
    for (const term of group) {
      if (seen.has(term) || term.length < 2) continue;
      seen.add(term);
      out.push(term);
      if (out.length >= maxTerms) return out;
    }
  }
  return out;
}

/**
 * Computes a relevance score (>= 0) for `haystack` against expanded query term groups.
 * Exact original-token hits score higher than synonym hits; covering all token groups gets a boost.
 */
export function scoreTextMatch(haystack: string, termGroups: string[][]): number {
  if (!termGroups.length) return 1;
  const lower = haystack.toLowerCase();
  let score = 0;
  let groupsMatched = 0;
  for (const group of termGroups) {
    const primary = group[0];
    if (primary && lower.includes(primary)) {
      score += 5;
      groupsMatched++;
      continue;
    }
    let synHit = false;
    for (let i = 1; i < group.length; i++) {
      if (lower.includes(group[i])) {
        score += 3;
        groupsMatched++;
        synHit = true;
        break;
      }
    }
    if (!synHit && primary && primary.length >= 4) {
      // CJK bigram fallback for compound terms not in dictionary
      let bigramHits = 0;
      for (let i = 0; i <= primary.length - 2; i += 2) {
        if (lower.includes(primary.slice(i, i + 2))) bigramHits++;
      }
      if (bigramHits >= 2) {
        score += 1.5;
        groupsMatched++;
      }
    }
  }
  if (groupsMatched === 0) return 0;
  if (groupsMatched === termGroups.length) score += 3;
  return score;
}
