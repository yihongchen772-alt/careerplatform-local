import { z } from "zod";

export const referralCodeEntrySchema = z.object({
  id: z.string().min(1).max(80),
  company: z.string().trim().min(1).max(80),
  code: z.string().trim().min(2).max(40),
  url: z.string().trim().max(2000).optional(),
  referrer: z.string().trim().max(60).optional(),
  note: z.string().trim().max(500).optional(),
  expiresAt: z.string().trim().max(30).optional(),
  createdAt: z.string().trim().max(40),
});

export type ReferralCodeEntry = z.infer<typeof referralCodeEntrySchema>;

export type ParsedReferralPost = {
  company: string;
  code: string;
  url: string;
  referrer: string;
  roles: string[];
  cities: string[];
  deadline: string;
  note: string;
};

const KNOWN_HOST_COMPANY: Array<[RegExp, string]> = [
  [/bytedance\.com|feishu\.cn.*bytedance/i, "字节跳动"],
  [/careers\.tencent\.com|join\.qq\.com/i, "腾讯"],
  [/alibaba\.com|aliyun\.com|taotian\.com|antgroup\.com/i, "阿里巴巴"],
  [/meituan\.com/i, "美团"],
  [/pinduoduo\.com/i, "拼多多"],
  [/huawei\.com/i, "华为"],
  [/dji\.com/i, "大疆"],
  [/xiaohongshu\.com/i, "小红书"],
  [/mihoyo\.com/i, "米哈游"],
  [/jd\.com/i, "京东"],
  [/baidu\.com/i, "百度"],
  [/kuaishou\.com/i, "快手"],
  [/nio\.com/i, "蔚来"],
  [/lixiang\.com/i, "理想汽车"],
  [/xiaopeng\.com/i, "小鹏汽车"],
  [/byd\.com/i, "比亚迪"],
  [/unitree/i, "宇树科技"],
  [/agibot/i, "智元机器人"],
];

const CITY_TOKENS = [
  "北京", "上海", "深圳", "杭州", "广州", "南京", "苏州", "成都", "武汉", "西安",
  "合肥", "重庆", "长沙", "天津", "厦门", "珠海", "宁波", "无锡", "青岛", "香港", "新加坡",
];

/** Extracts saved referral codes cleanly from User.applicationProfile JSON without touching other keys. */
export function readReferralVault(applicationProfileRaw: unknown): ReferralCodeEntry[] {
  if (!applicationProfileRaw || typeof applicationProfileRaw !== "object" || Array.isArray(applicationProfileRaw)) {
    return [];
  }
  const raw = (applicationProfileRaw as Record<string, unknown>).referralCodes;
  if (!Array.isArray(raw)) return [];
  const out: ReferralCodeEntry[] = [];
  for (const item of raw) {
    const parsed = referralCodeEntrySchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Deterministic Chinese campus-recruiting referral post parser (0 LLM cost).
 * Handles noisy WeChat / Nowcoder / Xiaohongshu posts to extract company, referral code,
 * apply URL, roles, cities, referrer, and deadline.
 */
export function parseReferralPostText(raw: string): ParsedReferralPost {
  const text = String(raw ?? "").replace(/\r\n/g, "\n").trim();

  // 1. Apply URL
  const urlMatch = /https?:\/\/[^\s"'<>）)】》]+/i.exec(text);
  const url = urlMatch ? urlMatch[0].replace(/[.,;，。；]+$/, "") : "";

  // 2. Referral code
  const codePatterns = [
    /(?:内推码|推荐码|邀请码|专属内推码|专属码|内推编号|Referral\s*Code)[：:\s【\[]*([A-Za-z0-9_-]{3,24})/i,
    /(?:填写|输入|使用)\s*([A-Z0-9]{5,12})\s*(?:免筛选|优先|直通|内推)/,
  ];
  let code = "";
  for (const re of codePatterns) {
    const m = re.exec(text);
    if (m?.[1] && !/^(http|https|www|com|cn)$/i.test(m[1])) {
      code = m[1].trim();
      break;
    }
  }

  // 3. Company name
  let company = "";
  const bracketMatch = /【([^】]{2,20})】/.exec(text);
  if (bracketMatch?.[1]) {
    company = bracketMatch[1]
      .replace(/(?:20\d{2}\s*届?|春招|秋招|校招|暑期实习|实习|内推|招聘|急招|直通)/g, "")
      .trim();
  }
  if (!company) {
    const labelMatch = /(?:公司|企业|单位)[：:\s]+([^\n，,。；;]{2,20})/.exec(text);
    if (labelMatch?.[1]) company = labelMatch[1].trim();
  }
  if (!company) {
    const leadMatch = /^([^\n，,。；;：:]{2,16}?)(?:20\d{2}\s*届?|秋招|春招|校招|暑期实习|内推|招聘)/.exec(text);
    if (leadMatch?.[1]) company = leadMatch[1].replace(/^[#@*\-\s]+/, "").trim();
  }
  if (!company && url) {
    for (const [re, name] of KNOWN_HOST_COMPANY) {
      if (re.test(url)) {
        company = name;
        break;
      }
    }
  }

  // 4. Referrer name
  const refMatch = /(?:内推人|推荐人|联系人)[：:\s]+([^\n，,。；;]{2,16})/.exec(text);
  const referrer = refMatch?.[1]?.trim() ?? "";

  // 5. Roles
  const roleMatch = /(?:热招岗位|招聘岗位|岗位|方向|职位)[：:\s]+([^\n]{2,120})/.exec(text);
  const roles = roleMatch?.[1]
    ? roleMatch[1]
        .split(/[、,，/｜|；;]+/)
        .map((r) => r.trim())
        .filter((r) => r.length >= 2 && r.length <= 36)
        .slice(0, 6)
    : [];

  // 6. Cities
  const cities = CITY_TOKENS.filter((c) => text.includes(c)).slice(0, 6);

  // 7. Deadline
  let deadline = "";
  const isoDate = /(?:截止|截至|deadline)[^\n\d]{0,12}(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2})/i.exec(text);
  if (isoDate?.[1]) {
    const nums = isoDate[1].match(/\d+/g);
    if (nums && nums.length === 3) {
      deadline = `${nums[0]}-${nums[1].padStart(2, "0")}-${nums[2].padStart(2, "0")}`;
    }
  } else {
    const mdDate = /(?:截止|截至)[^\n\d]{0,10}(\d{1,2})[月/.](\d{1,2})/.exec(text);
    if (mdDate) {
      const yr = new Date().getFullYear();
      deadline = `${yr}-${mdDate[1].padStart(2, "0")}-${mdDate[2].padStart(2, "0")}`;
    }
  }

  return {
    company,
    code,
    url,
    referrer,
    roles,
    cities,
    deadline,
    note: text.replace(/\s+/g, " ").slice(0, 260),
  };
}

/**
 * Finds the best matching referral code from the user's vault for an open application portal.
 * Matches by saved URL hostname/prefix first, then by company name against portal title/URL/company.
 */
export function matchReferralCodeForPage(
  codes: ReferralCodeEntry[],
  context: { url?: string | null; companyName?: string | null; title?: string | null }
): ReferralCodeEntry | null {
  if (!codes.length) return null;
  const pageUrl = (context.url ?? "").toLowerCase();
  const companyHint = `${context.companyName ?? ""} ${context.title ?? ""}`.toLowerCase();

  let pageHost = "";
  try {
    if (pageUrl) pageHost = new URL(pageUrl).hostname.toLowerCase();
  } catch { /* ignore */ }

  // 1. Exact saved hostname match (ignoring generic ATS domains unless path matches)
  const GENERIC_ATS = /(mokahr\.com|zhiye\.com|jobs\.feishu\.cn|hotjob\.cn|dayee\.com)$/i;
  for (const entry of codes) {
    if (!entry.url) continue;
    try {
      const saved = new URL(entry.url);
      const savedHost = saved.hostname.toLowerCase();
      if (pageHost && savedHost === pageHost) {
        if (!GENERIC_ATS.test(savedHost)) return entry;
        const savedSeg = saved.pathname.split("/").filter(Boolean)[0] ?? "";
        if (savedSeg && pageUrl.includes(savedSeg.toLowerCase())) return entry;
      }
    } catch { /* ignore */ }
  }

  // 2. Company name match against bound position company or page title/known host alias
  let hostCompany = "";
  for (const [re, name] of KNOWN_HOST_COMPANY) {
    if (pageUrl && re.test(pageUrl)) {
      hostCompany = name.toLowerCase();
      break;
    }
  }
  for (const entry of codes) {
    const c = entry.company.trim().toLowerCase();
    if (c.length < 2) continue;
    if ((companyHint && companyHint.includes(c)) || (hostCompany && (hostCompany.includes(c) || c.includes(hostCompany)))) {
      return entry;
    }
  }
  return null;
}
