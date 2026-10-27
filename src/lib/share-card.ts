// 求职战绩卡: a plain module so the in-app preview and the exported PNG are
// the same HTML — what the applicant sees is exactly what gets saved.

export type ShareApplication = {
  currentStage: string;
  stageHistory: { stage: string }[];
  companyName: string;
  industry: string | null;
};

export type ShareStats = {
  applied: number;
  /** Reached 测评 or 笔试 at least once. */
  assessed: number;
  /** Reached any interview round, 一面 through HR 面. */
  interviewed: number;
  offers: number;
  industries: { name: string; count: number; pct: number }[];
  offerCompanies: string[];
};

export type HeroMetric = "applied" | "interviewed" | "offers";
export type MidSection = "funnel" | "industry";

export type ShareCardOptions = {
  title: string;
  name: string;
  cohort: string;
  directions: string[];
  hero: HeroMetric;
  section: MidSection;
  showOfferCompanies: boolean;
};

const ASSESS = new Set(["ASSESSMENT", "OA"]);
const INTERVIEW = new Set(["INTERVIEW_1", "INTERVIEW_2", "INTERVIEW_3", "HR_INTERVIEW"]);
// A declined offer is still in the history as OFFER, so it still counts.
const OFFER = new Set(["OFFER", "ACCEPTED"]);

/**
 * "Reached" means the step is in the history (or is where the application
 * sits now); steps a company skipped are never credited, same rule as the
 * funnel in 洞察.
 */
function reached(app: ShareApplication, wanted: Set<string>): boolean {
  return wanted.has(app.currentStage) || app.stageHistory.some((h) => wanted.has(h.stage));
}

export function computeShareStats(apps: ShareApplication[]): ShareStats {
  const industry = new Map<string, number>();
  const offerCompanies: string[] = [];
  let assessed = 0;
  let interviewed = 0;
  let offers = 0;
  for (const app of apps) {
    if (reached(app, ASSESS)) assessed++;
    if (reached(app, INTERVIEW)) interviewed++;
    if (reached(app, OFFER)) {
      offers++;
      if (app.companyName && !offerCompanies.includes(app.companyName)) offerCompanies.push(app.companyName);
    }
    const name = (app.industry ?? "").trim() || "其他";
    industry.set(name, (industry.get(name) ?? 0) + 1);
  }
  const industries = [...industry.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] === "其他" ? 1 : b[0] === "其他" ? -1 : 0))
    .slice(0, 3)
    .map(([name, count]) => ({ name, count, pct: apps.length ? Math.round((count / apps.length) * 100) : 0 }));
  return { applied: apps.length, assessed, interviewed, offers, industries, offerCompanies };
}

export function defaultHero(stats: ShareStats): HeroMetric {
  if (stats.offers > 0) return "offers";
  if (stats.interviewed > 0) return "interviewed";
  return "applied";
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const HERO: Record<HeroMetric, { color: string; label: string; rate: string | null }> = {
  offers: { color: "#2f7d32", label: "个 Offer 到手", rate: "Offer 转化率" },
  interviewed: { color: "#3b3fb6", label: "场面试历练", rate: "面试转化率" },
  applied: { color: "#b8741a", label: "份投递足迹", rate: null },
};

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

export const SHARE_CARD_WIDTH = 420;
export const SHARE_CARD_HEIGHT = 746;

export const SHARE_CARD_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${SHARE_CARD_WIDTH}px; height: ${SHARE_CARD_HEIGHT}px; background: #f4efe4; overflow: hidden; }
  body { font: 14px/1.5 -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; color: #2b2a24; -webkit-font-smoothing: antialiased; }
  .card { width: ${SHARE_CARD_WIDTH}px; height: ${SHARE_CARD_HEIGHT}px; padding: 34px 32px 26px; display: flex; flex-direction: column; background: linear-gradient(180deg, #faf6ec 0%, #f1ead8 100%); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .title { font: 700 24px/1.25 Georgia, "Songti SC", "Noto Serif SC", "SimSun", serif; letter-spacing: 1px; }
  .cohort { flex: none; padding: 3px 12px; border-radius: 999px; background: #2b2a24; color: #f4efe4; font-size: 12px; letter-spacing: 1px; }
  .who { margin-top: 6px; color: #7a7461; font-size: 13px; }
  .dirs { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
  .dir { padding: 2px 10px; border-radius: 6px; background: rgba(43, 42, 36, .07); font-size: 12px; color: #4d493b; }
  .hero { margin-top: 40px; text-align: center; }
  .num { font: 700 128px/1 Georgia, "Songti SC", serif; letter-spacing: -2px; }
  .label { margin-top: 6px; font-size: 17px; letter-spacing: 2px; color: #4d493b; }
  .rate { display: inline-block; margin-top: 12px; padding: 3px 14px; border: 1.5px solid; border-radius: 999px; font-size: 13px; }
  .section { margin-top: 38px; padding: 20px 20px 22px; border-radius: 14px; background: rgba(255, 255, 255, .62); border: 1px solid rgba(43, 42, 36, .09); }
  .sh { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; font-size: 13px; color: #7a7461; }
  .sh b { color: #2b2a24; font-size: 14px; }
  .row { display: flex; align-items: center; gap: 10px; margin-top: 15px; font-size: 14px; }
  .row .name { width: 64px; flex: none; color: #4d493b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { flex: 1; height: 12px; border-radius: 999px; background: rgba(43, 42, 36, .08); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 999px; }
  .row .val { width: 74px; flex: none; text-align: right; font-variant-numeric: tabular-nums; color: #4d493b; }
  .offers { margin-top: 20px; font-size: 13px; color: #4d493b; text-align: center; line-height: 1.7; }
  .offers b { color: #2f7d32; }
  .foot { margin-top: auto; padding-top: 14px; display: flex; justify-content: space-between; font-size: 11px; color: #9a937b; letter-spacing: .5px; }
`;

export function shareCardBody(stats: ShareStats, options: ShareCardOptions): string {
  const hero = HERO[options.hero];
  const heroValue = options.hero === "offers" ? stats.offers : options.hero === "interviewed" ? stats.interviewed : stats.applied;
  const heroRate = hero.rate && stats.applied ? `${hero.rate} ${pct(heroValue, stats.applied)}%` : null;
  const title = options.title.trim() || "我的求职战绩";

  const funnel = [
    { name: "投递", count: stats.applied, color: "#8fa9d9" },
    { name: "笔试测评", count: stats.assessed, color: "#5c7fc4" },
    { name: "面试", count: stats.interviewed, color: "#3b3fb6" },
    { name: "Offer", count: stats.offers, color: "#2f7d32" },
  ];
  const bars = options.section === "funnel"
    ? funnel.map((row) => ({ name: row.name, share: pct(row.count, stats.applied), value: `${row.count} · ${pct(row.count, stats.applied)}%`, color: row.color }))
    : stats.industries.map((row, index) => ({ name: row.name, share: row.pct, value: `${row.count} 家 · ${row.pct}%`, color: ["#3b3fb6", "#6f8fd0", "#b3c3a0"][index] ?? "#b3c3a0" }));

  const offerLine = options.showOfferCompanies && stats.offerCompanies.length
    ? `<div class="offers">Offer 来自 <b>${stats.offerCompanies.slice(0, 6).map(esc).join("、")}</b>${stats.offerCompanies.length > 6 ? " 等" : ""}</div>`
    : "";

  return `<div class="card">
  <div class="head"><div class="title">${esc(title)}</div>${options.cohort.trim() ? `<div class="cohort">${esc(options.cohort.trim())}</div>` : ""}</div>
  ${options.name.trim() ? `<div class="who">@ ${esc(options.name.trim())}</div>` : ""}
  ${options.directions.length ? `<div class="dirs">${options.directions.slice(0, 5).map((d) => `<span class="dir">${esc(d)}</span>`).join("")}</div>` : ""}
  <div class="hero">
    <div class="num" style="color:${hero.color}">${heroValue}</div>
    <div class="label">${hero.label}</div>
    ${heroRate ? `<div class="rate" style="color:${hero.color};border-color:${hero.color}">${esc(heroRate)}</div>` : ""}
  </div>
  <div class="section">
    <div class="sh"><b>${options.section === "funnel" ? "转化漏斗" : "投递行业"}</b><span>共 ${stats.applied} 家</span></div>
    ${bars.map((row) => `<div class="row"><span class="name">${esc(row.name)}</span><span class="bar"><i style="width:${Math.max(row.share, row.share > 0 ? 3 : 0)}%;background:${row.color}"></i></span><span class="val">${esc(row.value)}</span></div>`).join("") || `<div class="row" style="color:#9a937b">还没有投递记录</div>`}
  </div>
  ${offerLine}
  <div class="foot"><span>求职罗盘</span><span>数据只存在我自己的电脑</span></div>
</div>`;
}

export function shareCardHtml(stats: ShareStats, options: ShareCardOptions): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>求职战绩</title><style>${SHARE_CARD_CSS}</style></head><body>${shareCardBody(stats, options)}</body></html>`;
}

/** 「后端 产品，运营」 → ["后端", "产品", "运营"]; a handful at most. */
export function parseDirections(text: string): string[] {
  return [...new Set(text.split(/[\s,，、/;；]+/).map((part) => part.trim()).filter(Boolean))].slice(0, 5);
}
