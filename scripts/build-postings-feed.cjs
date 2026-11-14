const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const BOARDS = [
  // 飞书招聘 (Feishu ATSX: jobs.bytedance.com / *.jobs.feishu.cn)
  { name: "字节跳动校招", careers_url: "https://jobs.bytedance.com/campus/position", industry: "互联网/AI" },
  { name: "字节跳动", careers_url: "https://jobs.bytedance.com", industry: "互联网/AI" },
  { name: "蔚来校招", careers_url: "https://nio.jobs.feishu.cn/campus/position", industry: "智能汽车/智驾/具身" },
  { name: "蔚来汽车", careers_url: "https://nio.jobs.feishu.cn", industry: "智能汽车/智驾" },
  { name: "MiniMax", careers_url: "https://vrfi1sk8a0.jobs.feishu.cn", industry: "AI大模型" },
  { name: "智元机器人", careers_url: "https://agirobot.jobs.feishu.cn", industry: "具身智能/机器人" },
  { name: "非夕机器人", careers_url: "https://flexivrobotics.jobs.feishu.cn", industry: "具身智能/机器人" },
  { name: "光轮智能", careers_url: "https://lightwheel.jobs.feishu.cn", industry: "具身智能/仿真合成数据" },
  // Moka (app.mokahr.com)
  { name: "DeepSeek", careers_url: "https://app.mokahr.com/social-recruitment/high-flyer/140576", industry: "AI大模型/量化" },
  { name: "月之暗面", careers_url: "https://app.mokahr.com/apply/moonshot/148506", industry: "AI大模型" },
  { name: "智谱AI", careers_url: "https://app.mokahr.com/social-recruitment/zphz/148983", industry: "AI大模型" },
  { name: "远景科技校招", careers_url: "https://app.mokahr.com/campus-recruitment/envisiongroup/43123", industry: "新能源/智能控制/AI" },
  { name: "思谋科技校招", careers_url: "https://app.mokahr.com/campus-recruitment/smartmore/40506", industry: "视觉AI/智能制造" },
  // 北森 Beisen (*.zhiye.com)
  { name: "科大讯飞", careers_url: "https://iflytek.zhiye.com/campus", industry: "AI大模型/语音" },
  { name: "越疆机器人", careers_url: "https://dobot.zhiye.com/campus", industry: "具身智能/机器人" },
  { name: "石头科技", careers_url: "https://roborock.zhiye.com/campus", industry: "智能硬件/机器人" },
  { name: "海柔创新", careers_url: "https://hairobotics.zhiye.com/campus", industry: "物流机器人/运控" },
  { name: "埃夫特机器人", careers_url: "https://efort.zhiye.com/campus", industry: "工业/人形机器人" },
  { name: "中科曙光", careers_url: "https://sugon.zhiye.com/campus", industry: "算力基础设施/芯片/系统" },
  { name: "京东方BOE", careers_url: "https://boe.zhiye.com/campus", industry: "半导体/显示/硬件" },
  { name: "大华股份", careers_url: "https://dahua.zhiye.com/campus", industry: "智能物联/视觉AI" },
  { name: "迈瑞医疗", careers_url: "https://mindray.zhiye.com/campus", industry: "医疗器械/研发" },
  { name: "奇瑞汽车", careers_url: "https://chery.zhiye.com/campus", industry: "智能汽车/智驾" },
  { name: "信捷电气", careers_url: "https://xinje.zhiye.com/campus", industry: "工业自动化/运动控制" },
];

const OVERSEAS_LOCATION_RE =
  /^(?:新加坡|东京|大阪|首尔|西雅图|圣何塞|山景城|旧金山|纽约|洛杉矶|奥斯汀|波士顿|芝加哥|多伦多|温哥华|伦敦|都柏林|阿姆斯特丹|慕尼黑|柏林|法兰克福|巴黎|苏黎世|华沙|斯德哥尔摩|马德里|米兰|迪拜|利雅得|开罗|雅加达|吉隆坡|曼谷|胡志明市?|河内|马尼拉|悉尼|墨尔本|孟买|班加罗尔|新德里|墨西哥城?|圣保罗|布宜诺斯艾利斯|圣地亚哥|Singapore|Tokyo|Osaka|Seoul|Seattle|San\s*Jose|Mountain\s*View|San\s*Francisco|New\s*York|Los\s*Angeles|Austin|Boston|Toronto|Vancouver|London|Dublin|Amsterdam|Munich|Berlin|Paris|Warsaw|Dubai|Jakarta|Kuala\s*Lumpur|Bangkok|Ho\s*Chi\s*Minh|Manila|Sydney|Melbourne|Mumbai|Bangalore|Bengaluru|Mexico|Sao\s*Paulo|US|USA|UK|Germany|Japan|Korea|India|Indonesia|Thailand|Vietnam|Malaysia|Philippines|Australia|Brazil|Canada|France)$/i;

const DOMESTIC_CITY_IN_TITLE_RE =
  /(?:[（(【\-\s·/]|^)(北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|合肥|重庆|长沙|郑州|天津|青岛|厦门|无锡|宁波|珠海|东莞|佛山|福州|济南|大连|沈阳|哈尔滨|长春|南昌|石家庄|太原|昆明|贵阳|南宁|海口|兰州|香港|澳门)(?:市|[）)】\-\s·/]|$)/;

function cleanCities(location, title = "") {
  const rawParts = String(location || "")
    .replace(/中国[-/·]?/g, "")
    .split(/[/,，、;|]+/)
    .map((s) => s.trim().replace(/^(?:中国|大陆)[-·\s]*/, "").replace(/市$/, "").replace(/总部$/, ""))
    .filter((s) => s && s.length <= 24 && !/^(远程|不限|全國|全国)$/i.test(s));
  const domesticParts = rawParts.filter((s) => !OVERSEAS_LOCATION_RE.test(s));
  if (rawParts.length > 0 && domesticParts.length === 0) {
    return { cities: null, overseasOnly: true };
  }
  if (domesticParts.length === 0 && title) {
    const m = DOMESTIC_CITY_IN_TITLE_RE.exec(String(title));
    if (m && m[1]) domesticParts.push(m[1]);
  }
  const unique = [...new Set(domesticParts)].slice(0, 8);
  return { cities: unique.length ? unique.join("、") : null, overseasOnly: false };
}

function inferKind(title, description, careersUrl = "") {
  const text = `${title} ${String(description || "").slice(0, 400)}`;
  if (/暑期实习|summer\s*intern/i.test(text)) return "暑期实习";
  if (/实习|intern/i.test(text)) return "实习";
  if (/提前批/.test(text)) return "秋招提前批";
  if (/补录/.test(text)) return "秋招补录";
  if (/春招|春季校园/.test(text)) return "春招";
  if (/人才计划|天才少年|青云|筋斗云|北斗|星火|未来星|管培生/.test(text)) return "人才计划";
  if (
    /校招|校园招聘|应届|毕业生|campus|\d{2,4}\s*届/i.test(text) ||
    /(?:\/campus\b|campus-recruitment|join\.qq\.com)/i.test(careersUrl)
  ) {
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
      if (/第三方派遣|Third-party Associate/i.test(`${title} ${desc}`)) continue;
      const { cities, overseasOnly } = cleanCities(job.location, title);
      if (overseasOnly) continue;

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
        cities,
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
