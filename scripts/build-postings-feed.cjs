const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const BOARDS = [
  { name: "字节跳动", careers_url: "https://jobs.bytedance.com", industry: "互联网/AI" },
  { name: "腾讯", careers_url: "https://careers.tencent.com/search.html", industry: "互联网/游戏/AI" },
  { name: "阿里巴巴", careers_url: "https://talent.alibaba.com/off-campus/position-list", industry: "互联网/电商/云" },
  { name: "美团", careers_url: "https://zhaopin.meituan.com/web/social", industry: "互联网/本地生活" },
  { name: "DeepSeek", careers_url: "https://app.mokahr.com/social-recruitment/high-flyer/140576", industry: "AI大模型/量化" },
  { name: "DeepSeek校招", careers_url: "https://app.mokahr.com/campus-recruitment/high-flyer/140575", industry: "AI大模型/量化" },
  { name: "月之暗面", careers_url: "https://app.mokahr.com/apply/moonshot/148506", industry: "AI大模型" },
  { name: "智谱AI", careers_url: "https://app.mokahr.com/social-recruitment/zphz/148983", industry: "AI大模型" },
  { name: "MiniMax", careers_url: "https://vrfi1sk8a0.jobs.feishu.cn", industry: "AI大模型" },
  { name: "博世中国", careers_url: "https://jobs.smartrecruiters.com/BoschGroup", industry: "汽车/智能制造/外企" },
  { name: "Databricks", careers_url: "https://boards.greenhouse.io/databricks", industry: "云计算/大数据/AI" },
  { name: "Cloudflare", careers_url: "https://boards.greenhouse.io/cloudflare", industry: "云计算/基础架构" },
  { name: "Stripe", careers_url: "https://boards.greenhouse.io/stripe", industry: "金融科技/外企" },
  { name: "Figma", careers_url: "https://boards.greenhouse.io/figma", industry: "设计/研发工具" },
  { name: "Airbnb", careers_url: "https://boards.greenhouse.io/airbnb", industry: "互联网/外企" },
  { name: "Linear", careers_url: "https://jobs.ashbyhq.com/linear", industry: "研发工具/外企" },
];

function cleanCities(location) {
  if (!location) return null;
  const parts = String(location)
    .replace(/中国[-/·]?/g, "")
    .split(/[/,，、;|]+/)
    .map((s) => s.trim().replace(/^(?:中国|大陆)[-·\s]*/, "").replace(/市$/, ""))
    .filter((s) => s && s.length <= 24 && !/^(远程|不限|全國|全国)$/i.test(s));
  const unique = [...new Set(parts)].slice(0, 8);
  return unique.length ? unique.join("、") : null;
}

function inferKind(title, description, careersUrl = "") {
  const text = `${title} ${String(description || "").slice(0, 300)}`;
  if (/暑期实习|summer\s*intern/i.test(text)) return "暑期实习";
  if (/实习|intern/i.test(text)) return "实习";
  if (/提前批/.test(text)) return "秋招提前批";
  if (/补录/.test(text)) return "秋招补录";
  if (/春招|春季校园/.test(text)) return "春招";
  if (/人才计划|天才少年|青云|筋斗云|北斗|星火|未来星|管培生/.test(text)) return "人才计划";
  if (/校招|校园招聘|应届|毕业生|campus|\d{2,4}\s*届/i.test(text) || /campus-recruitment/i.test(careersUrl)) {
    return "秋招";
  }
  return "社招";
}

function inferCohort(title, description) {
  const text = `${title} ${String(description || "").slice(0, 400)}`;
  const matches = text.match(/202[5-9]\s*届|\b2[5-9]\s*届/g);
  if (!matches || !matches.length) return null;
  const normalized = [
    ...new Set(
      matches.map((m) => {
        const digits = m.replace(/\D+/g, "");
        return digits.length === 2 ? `20${digits}届` : `${digits}届`;
      })
    ),
  ];
  return normalized.join("、");
}

function inferDegree(description) {
  const head = String(description || "").slice(0, 600);
  if (/博士及以上|博士学历/.test(head)) return "博士";
  if (/硕士及以上|研究生及以上|硕士学历/.test(head)) return "硕士及以上";
  if (/本科及以上|本科学历|统招本科|bachelor/i.test(head)) return "本科及以上";
  return null;
}

function formatYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function runCareerOps(boards, maxPages = 4, timeoutMs = 35000) {
  const runner = path.resolve(__dirname, "..", "electron", "career-ops", "run.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => child.kill(), timeoutMs + 10000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(out);
        if (!Array.isArray(parsed.results)) {
          return reject(new Error(parsed.error || "career-ops returned no results"));
        }
        resolve(parsed.results);
      } catch (err) {
        reject(new Error(`Failed to parse career-ops output: ${err.message}`));
      }
    });
    child.stdin.end(JSON.stringify({ boards, maxPages, timeoutMs }));
  });
}

async function buildFeed() {
  const now = new Date();
  const todayIso = formatYmd(now);
  const metaByName = new Map(BOARDS.map((b) => [b.name, b]));
  const results = await runCareerOps(
    BOARDS.map((b) => ({ name: b.name, careers_url: b.careers_url, keywords: [] })),
    4,
    35000
  );

  const seen = new Map();
  const summary = [];

  for (const board of results) {
    const meta = metaByName.get(board.name);
    const jobs = Array.isArray(board.jobs) ? board.jobs : [];
    summary.push({ name: board.name, count: jobs.length, error: board.error || null });
    for (const job of jobs) {
      const company = String(job.company || board.name || "")
        .replace(/(?:校招|校园招聘|社招)$/, "")
        .trim()
        .slice(0, 120);
      const title = String(job.title || "").trim().slice(0, 200);
      const url = String(job.url || "").trim();
      if (!company || !title || !/^https?:\/\//i.test(url)) continue;

      const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 20);
      const externalId = `feed:${hash}`;
      if (seen.has(externalId)) continue;

      const desc = String(job.description || "").trim();
      let startDate = todayIso;
      if (typeof job.postedAt === "number" && Number.isFinite(job.postedAt) && job.postedAt > 0) {
        const d = new Date(job.postedAt);
        if (!Number.isNaN(d.getTime()) && d <= now && d.getUTCFullYear() >= 2023) {
          startDate = formatYmd(d);
        }
      }

      seen.set(externalId, {
        externalId,
        company,
        roles: title,
        cohort: inferCohort(title, desc),
        kind: inferKind(title, desc, meta?.careers_url),
        cities: cleanCities(job.location),
        industry: meta?.industry || "互联网/科技",
        degree: inferDegree(desc),
        writtenTest: null,
        applyUrl: url,
        noticeUrl: null,
        startDate,
        deadline: null,
        deadlineText: "招满即止",
        note: desc ? desc.replace(/\s+/g, " ").slice(0, 500) : null,
        salary: null,
      });
    }
  }

  const items = [...seen.values()];
  if (items.length === 0) {
    throw new Error(`No postings collected across ${BOARDS.length} boards: ${JSON.stringify(summary)}`);
  }

  const rev = Math.floor(now.getTime() / 1000);
  const generatedAt = now.toISOString();
  const payload = {
    version: 1,
    rev,
    generatedAt,
    name: "内置名企官网每日直招池",
    total: items.length,
    boards: summary,
    items,
  };
  const metaPayload = {
    version: 1,
    rev,
    generatedAt,
    total: items.length,
    boards: summary,
  };

  const outDir = path.resolve(__dirname, "..", ".local-run", "postings-feed");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonText = JSON.stringify(payload);
  const gzBuf = zlib.gzipSync(Buffer.from(jsonText, "utf8"), { level: 9 });

  fs.writeFileSync(path.join(outDir, "postings-feed.json"), jsonText, "utf8");
  fs.writeFileSync(path.join(outDir, "postings-feed.json.gz"), gzBuf);
  fs.writeFileSync(path.join(outDir, "postings-feed-meta.json"), JSON.stringify(metaPayload, null, 2), "utf8");

  console.log(
    `Built postings feed: ${items.length} jobs from ${summary.filter((s) => s.count > 0).length}/${BOARDS.length} boards (${(gzBuf.length / 1024).toFixed(1)} KiB gzipped)`
  );
}

if (require.main === module) {
  buildFeed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { BOARDS, buildFeed };
