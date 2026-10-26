/**
 * The one word a company is listed under when 投递 are grouped by 行业: the
 * part of 细分行业 before the slash ("新能源/电池" → 新能源), else 大类 ("制造业").
 */
export const NO_INDUSTRY = "未分类";

export function industryLabel(company: { industry?: string | null; sector?: string | null }): string {
  const fine = (company.industry ?? "").trim().split(/[/／、,，]/)[0]?.trim();
  return fine || (company.sector ?? "").trim() || NO_INDUSTRY;
}

/** What the AI is asked to choose from, so the groups stay few and comparable. */
export const INDUSTRIES = [
  "互联网", "软件服务", "半导体", "机器人", "智能硬件", "消费电子", "家电", "汽车", "新能源", "通信",
  "工业自动化", "装备制造", "能源化工", "金融", "消费品", "医药医疗", "专业服务", "传媒游戏", "物流", "地产", "其他",
] as const;

/** Keeps only an answer that names the company asked about, with a usable industry. */
export function cleanIndustryAnswers(
  asked: string[],
  answers: { name?: unknown; industry?: unknown; sector?: unknown }[],
): { name: string; industry: string; sector: string | null }[] {
  const wanted = new Set(asked);
  const seen = new Set<string>();
  const out: { name: string; industry: string; sector: string | null }[] = [];
  for (const answer of answers) {
    const name = typeof answer.name === "string" ? answer.name.trim() : "";
    const industry = typeof answer.industry === "string" ? answer.industry.trim().slice(0, 30) : "";
    if (!wanted.has(name) || seen.has(name) || !industry || industry === NO_INDUSTRY) continue;
    seen.add(name);
    const sector = typeof answer.sector === "string" && answer.sector.trim() ? answer.sector.trim().slice(0, 20) : null;
    out.push({ name, industry, sector });
  }
  return out;
}
