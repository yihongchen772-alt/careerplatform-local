export const BUILTIN_FEED_URL = "builtin://official-feed";
export const BUILTIN_FEED_NAME = "内置名企官网每日直招池";

export type FeedShardDef = {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  allowOverseas?: boolean;
};

export type FeedShardStat = {
  id: string;
  total: number;
  boardsCount: number;
  gzBytes?: number;
};

export type FeedMetaSummary = {
  generatedAt: string | null;
  rev: number | null;
  total: number;
  shards: Record<string, FeedShardStat>;
};

export const FEED_SHARD_DEFS: FeedShardDef[] = [
  {
    id: "core-ai-tech",
    name: "AI大模型 · 互联网 · 软件",
    description: "Moka / 飞书 / 北森（标准一键填表）",
    defaultEnabled: true,
  },
  {
    id: "core-robotics-hardtech",
    name: "具身机器人 · 智驾 · 芯片硬件",
    description: "Moka / 飞书 / 北森（标准一键填表）",
    defaultEnabled: true,
  },
  {
    id: "core-enterprise-fintech",
    name: "央国企 · 金融量化 · 医疗信创",
    description: "Moka / 飞书 / 北森（标准一键填表）",
    defaultEnabled: true,
  },
  {
    id: "ext-dayee",
    name: "大易 Dayee 国央企 & 车企券商",
    description: "中国中车 / 地平线 / 上海电气 / 中信华泰广发等（大易填表）",
    defaultEnabled: false,
  },
  {
    id: "ext-majors",
    name: "腾讯 · 阿里 · 美团 全量直招",
    description: "大厂全系校招与社招补充池",
    defaultEnabled: false,
  },
  {
    id: "ext-global",
    name: "全球前沿 AI & 机器人外企",
    description: "Anthropic / OpenAI / Figure / Waymo / Databricks 等",
    defaultEnabled: false,
    allowOverseas: true,
  },
];

export const DEFAULT_BUILTIN_SHARDS = FEED_SHARD_DEFS.filter((s) => s.defaultEnabled).map((s) => s.id);
const VALID_SHARD_IDS = new Set(FEED_SHARD_DEFS.map((s) => s.id));

export function isBuiltinFeedUrl(url: string | null | undefined): boolean {
  return !!url && (url === BUILTIN_FEED_URL || url.startsWith(`${BUILTIN_FEED_URL}?`));
}

export function parseBuiltinFeedShards(url: string | null | undefined): string[] {
  if (!url || url === BUILTIN_FEED_URL) return [...DEFAULT_BUILTIN_SHARDS];
  const idx = url.indexOf("?");
  if (idx < 0) return [...DEFAULT_BUILTIN_SHARDS];
  const params = new URLSearchParams(url.slice(idx + 1));
  const raw = params.get("shards");
  if (!raw) return [...DEFAULT_BUILTIN_SHARDS];
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => VALID_SHARD_IDS.has(s));
  return list.length ? [...new Set(list)] : [...DEFAULT_BUILTIN_SHARDS];
}

export function formatBuiltinFeedUrl(shards?: string[] | null): string {
  const clean = (shards ?? [])
    .map((s) => s.trim())
    .filter((s) => VALID_SHARD_IDS.has(s));
  const unique = clean.length ? [...new Set(clean)] : [...DEFAULT_BUILTIN_SHARDS];
  const isDefault =
    unique.length === DEFAULT_BUILTIN_SHARDS.length &&
    DEFAULT_BUILTIN_SHARDS.every((id) => unique.includes(id));
  return isDefault ? BUILTIN_FEED_URL : `${BUILTIN_FEED_URL}?shards=${unique.join(",")}`;
}
