const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const CATALOG_PATH = path.resolve(__dirname, "..", "electron", "career-ops", "boards-catalog.json");
const BOARDS = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));

const FEED_SHARDS = [
  {
    id: "core-ai-tech",
    name: "AI大模型 · 互联网 · 软件",
    description: "Moka / 飞书 / 北森（支持标准一键填表）",
    defaultEnabled: true,
    allowOverseas: false,
  },
  {
    id: "core-robotics-hardtech",
    name: "具身机器人 · 智驾 · 芯片硬件",
    description: "Moka / 飞书 / 北森（支持标准一键填表）",
    defaultEnabled: true,
    allowOverseas: false,
  },
  {
    id: "core-enterprise-fintech",
    name: "央国企 · 金融量化 · 医疗信创",
    description: "Moka / 飞书 / 北森（支持标准一键填表）",
    defaultEnabled: true,
    allowOverseas: false,
  },
  {
    id: "ext-dayee",
    name: "大易 Dayee 国央企 & 车企券商",
    description: "中国中车 / 地平线 / 上海电气 / 中信华泰广发等（支持大易填表）",
    defaultEnabled: false,
    allowOverseas: false,
  },
  {
    id: "ext-majors",
    name: "腾讯 · 阿里 · 美团 全量直招",
    description: "大厂全系校招与社招补充池",
    defaultEnabled: false,
    allowOverseas: false,
  },
  {
    id: "ext-global",
    name: "全球前沿 AI & 机器人外企",
    description: "Anthropic / OpenAI / Figure / Waymo / Databricks / Stripe 等",
    defaultEnabled: false,
    allowOverseas: true,
  },
];

const OVERSEAS_LOCATION_RE =
  /^(?:新加坡|东京|大阪|首尔|西雅图|圣何塞|山景城|旧金山|纽约|洛杉矶|奥斯汀|波士顿|芝加哥|多伦多|温哥华|伦敦|都柏林|阿姆斯特丹|慕尼黑|柏林|法兰克福|巴黎|苏黎世|华沙|斯德哥尔摩|马德里|米兰|迪拜|利雅得|开罗|雅加达|吉隆坡|曼谷|胡志明市?|河内|马尼拉|悉尼|墨尔本|孟买|班加罗尔|新德里|墨西哥城?|圣保罗|布宜诺斯艾利斯|圣地亚哥|Singapore|Tokyo|Osaka|Seoul|Seattle|San\s*Jose|Mountain\s*View|San\s*Francisco|New\s*York|Los\s*Angeles|Austin|Boston|Toronto|Vancouver|London|Dublin|Amsterdam|Munich|Berlin|Paris|Warsaw|Dubai|Jakarta|Kuala\s*Lumpur|Bangkok|Ho\s*Chi\s*Minh|Manila|Sydney|Melbourne|Mumbai|Bangalore|Bengaluru|Mexico|Sao\s*Paulo|US|USA|UK|Germany|Japan|Korea|India|Indonesia|Thailand|Vietnam|Malaysia|Philippines|Australia|Brazil|Canada|France)$/i;

const DOMESTIC_CITY_IN_TITLE_RE =
  /(?:[（(【\-\s·/]|^)(北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|合肥|重庆|长沙|郑州|天津|青岛|厦门|无锡|宁波|珠海|东莞|佛山|福州|济南|大连|沈阳|哈尔滨|长春|南昌|石家庄|太原|昆明|贵阳|南宁|海口|兰州|香港|澳门)(?:市|[）)】\-\s·/]|$)/;

function cleanCities(location, title = "", allowOverseas = false) {
  const rawParts = String(location || "")
    .replace(/中国[-/·]?/g, "")
    .split(/[/,，、;|]+/)
    .map((s) => s.trim().replace(/^(?:中国|大陆)[-·\s]*/, "").replace(/市$/, "").replace(/总部$/, ""))
    .filter((s) => s && s.length <= 28 && !/^(远程|不限|全國|全国)$/i.test(s));
  if (allowOverseas) {
    const unique = [...new Set(rawParts)].slice(0, 6);
    return { cities: unique.length ? unique.join("、") : "全球/远程", overseasOnly: false };
  }
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
    /校招|校园招聘|应届|毕业生|campus|\/school\.html|\d{2,4}\s*届/i.test(text) ||
    /(?:\/campus\b|campus-recruitment|join\.qq\.com)/i.test(careersUrl)
  ) {
    return "秋招";
  }
  return "社招";
}

function inferCohort(title, description) {
  const text = `${title} ${String(description || "").slice(0, 2000)}`;
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
  const head = String(description || "").slice(0, 2000);
  if (/博士及以上|博士学历/.test(head)) return "博士";
  if (/硕士及以上|研究生及以上|硕士研究生及以上|硕士学历/.test(head)) return "硕士及以上";
  if (/本科及以上|本科学历|统招本科|bachelor/i.test(head)) return "本科及以上";
  return null;
}

function inferSalary(title, description) {
  const text = `${title} ${String(description || "").slice(0, 1200)}`;
  const m = text.match(/(?:\d{1,3}(?:\.\d+)?\s*[-~～至]\s*\d{1,3}(?:\.\d+)?\s*(?:[kKwW万]|元\s*\/\s*[天月年]|\/\s*[天月]))/);
  return m ? m[0].replace(/\s+/g, "").slice(0, 40) : null;
}

function formatYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function runCareerOpsBatch(boards, { maxPages = 10, timeoutMs = 35000, maxJobsPerBoard = 1200, concurrency = 10 } = {}) {
  const runner = path.resolve(__dirname, "..", "electron", "career-ops", "run.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => child.kill(), Math.max(timeoutMs * 4, 120000));
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
    child.stdin.end(JSON.stringify({
      boards,
      maxBoards: boards.length,
      maxPages,
      timeoutMs,
      maxJobsPerBoard,
      concurrency,
    }));
  });
}

async function runCareerOps(boards, options = {}) {
  const BATCH_SIZE = 55;
  const all = [];
  for (let i = 0; i < boards.length; i += BATCH_SIZE) {
    const slice = boards.slice(i, i + BATCH_SIZE);
    const part = await runCareerOpsBatch(slice, options);
    all.push(...part);
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(boards.length / BATCH_SIZE)}: ${part.length} boards finished`);
  }
  return all;
}

async function buildFeed() {
  const now = new Date();
  const todayIso = formatYmd(now);
  const shardDefById = new Map(FEED_SHARDS.map((s) => [s.id, s]));
  const metaByKey = new Map();
  for (const b of BOARDS) {
    metaByKey.set(`${b.name}||${b.careers_url}`, b);
  }

  const results = await runCareerOps(
    BOARDS.map((b) => ({ name: b.name, careers_url: b.careers_url, keywords: [] })),
    { maxPages: 12, timeoutMs: 35000, maxJobsPerBoard: 1500, concurrency: 10 }
  );

  const shardBuckets = new Map(FEED_SHARDS.map((s) => [s.id, new Map()]));
  const summary = [];

  for (let idx = 0; idx < results.length; idx++) {
    const board = results[idx];
    const meta = metaByKey.get(`${board.name}||${BOARDS[idx]?.careers_url || ""}`) || BOARDS[idx];
    const shardId = meta?.track && shardBuckets.has(meta.track) ? meta.track : "core-ai-tech";
    const shardDef = shardDefById.get(shardId);
    const seen = shardBuckets.get(shardId);
    const jobs = Array.isArray(board.jobs) ? board.jobs : [];
    summary.push({ name: board.name, track: shardId, count: jobs.length, error: board.error || null });

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
      const { cities, overseasOnly } = cleanCities(job.location, title, shardDef?.allowOverseas);
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
        salary: inferSalary(title, desc),
      });
    }
  }

  const outDir = path.resolve(__dirname, "..", ".local-run", "postings-feed");
  fs.mkdirSync(outDir, { recursive: true });
  const rev = Math.floor(now.getTime() / 1000);
  const generatedAt = now.toISOString();

  const shardsMeta = [];
  const defaultCoreItems = new Map();
  let totalAll = 0;

  for (const shard of FEED_SHARDS) {
    const items = [...shardBuckets.get(shard.id).values()];
    totalAll += items.length;
    if (shard.defaultEnabled) {
      for (const item of items) {
        if (!defaultCoreItems.has(item.externalId)) defaultCoreItems.set(item.externalId, item);
      }
    }
    const file = `postings-feed-shard-${shard.id}.json.gz`;
    const shardPayload = {
      version: 2,
      rev,
      generatedAt,
      shard: shard.id,
      name: shard.name,
      total: items.length,
      items,
    };
    const gzBuf = zlib.gzipSync(Buffer.from(JSON.stringify(shardPayload), "utf8"), { level: 9 });
    fs.writeFileSync(path.join(outDir, file), gzBuf);
    shardsMeta.push({
      id: shard.id,
      name: shard.name,
      description: shard.description,
      defaultEnabled: shard.defaultEnabled,
      file,
      total: items.length,
      gzBytes: gzBuf.length,
      boardsCount: summary.filter((s) => s.track === shard.id && s.count > 0).length,
    });
  }

  const coreItems = [...defaultCoreItems.values()];
  if (coreItems.length === 0) {
    throw new Error(`No core postings collected across ${BOARDS.length} boards`);
  }

  const legacyPayload = {
    version: 2,
    rev,
    generatedAt,
    name: "内置名企官网每日直招池",
    total: coreItems.length,
    boards: summary,
    items: coreItems,
  };
  const legacyGz = zlib.gzipSync(Buffer.from(JSON.stringify(legacyPayload), "utf8"), { level: 9 });
  fs.writeFileSync(path.join(outDir, "postings-feed.json.gz"), legacyGz);

  const metaPayload = {
    version: 2,
    rev,
    generatedAt,
    name: "内置名企官网每日直招池",
    total: totalAll,
    coreTotal: coreItems.length,
    shards: shardsMeta,
    boards: summary,
  };
  fs.writeFileSync(path.join(outDir, "postings-feed-meta.json"), JSON.stringify(metaPayload, null, 2), "utf8");

  console.log(
    `Built sharded feed: core=${coreItems.length}, total=${totalAll} jobs across ${summary.filter((s) => s.count > 0).length}/${BOARDS.length} boards`
  );
  for (const s of shardsMeta) {
    console.log(`  - ${s.id} (${s.name}): ${s.total} jobs from ${s.boardsCount} boards (${(s.gzBytes / 1024).toFixed(1)} KiB gz)`);
  }
}

if (require.main === module) {
  buildFeed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { BOARDS, FEED_SHARDS, buildFeed };
