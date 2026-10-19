import { randomUUID } from "node:crypto";
import { EXTRA_FIELDS, type ApplicationProfile, type LearnedEntry } from "@/lib/application-profile";
import { MEMORY_CATEGORIES, MEMORY_LISTS, memoryAnchor, memoryContent, sameMemoryEntity, type MemoryCapture, type MemoryCategory, type MemoryContent } from "@/lib/application-memory";

// What the applicant types into a 网申 by hand is usually something 网申资料
// does not have yet (研究方向, 是否接受调剂, a 校园经历). Asking them to review
// each one in 待核对 meant it was typed again on the next site, so what fills
// a blank is written in straight away — with 撤销, and never over anything
// already there. Everything else still goes to 待核对.

/** 网申资料 fields a hand-typed answer may fill while they are blank. */
export const LEARNABLE_FACTS: Record<string, string> = {
  ...Object.fromEntries(EXTRA_FIELDS.map((field) => [field.key, field.label])),
  preferredCities: "期望城市",
};

/**
 * Picked per company (歌尔's 潍坊, one employer's job list): never written in
 * by itself, only when the applicant chooses to in 待核对.
 */
const PER_COMPANY = new Set(["preferredCities", "targetRole"]);

/** Further edits on the page that taught something keep it up to date for this long. */
export const LEARN_SESSION_MS = 3 * 3_600_000;
const KEEP_DAYS = 30;

// What a dropdown shows before a choice, never a value worth keeping.
const PLACEHOLDER = /^(?:请|点击|點擊)?(?:选择|选取|输入|填写|搜索)|^(?:select|choose|please (?:select|choose|enter)|search)\b/i;
// A 是 / 否 answer can be a fact (是否接受调剂) but never the name of a 经历.
const NOT_A_NAME = /^(?:是|否|有|无|暂无|yes|no|n\/?a|none|其他|其它)$/i;

const FIELD_LABELS: Record<string, string> = { school: "学校", major: "专业", department: "院系 / 部门", degree: "学历", gpa: "GPA", start: "开始时间", end: "结束时间", company: "单位", role: "职务", name: "名称", level: "级别", date: "时间", issuer: "颁发单位", description: "描述", responsibilities: "职责", category: "类别", score: "分数", language: "语种" };

/** Label → 网申资料 field for answers captured before the browser sent one (old 待核对 rows). */
const LABEL_KEYS: Array<[RegExp, string, RegExp?]> = [
  [/研究方向|研究领域|research (?:direction|interest|area)/i, "researchDirection"],
  [/成绩排名|专业排名|绩点排名|年级排名|班级排名|学习成绩排名/, "rank"],
  [/主修课程|专业课程|核心课程|主要课程/, "courses"],
  [/调剂|是否服从/, "acceptAdjust", /工作地|城市|地点/],
  [/(?:^|[^a-z])qq(?:号|号码)?(?:$|[^a-z])/i, "qq"],
  [/个人主页|个人网站|作品链接|作品集|个人博客|github|portfolio|personal (?:website|homepage)/i, "homepage", /linkedin|领英/i],
  [/实验室|课题组/, "lab", /是否|安全/],
  [/兴趣爱好|个人爱好|爱好特长|^爱好|hobb/i, "hobbies"],
  [/毕业论文|学位论文|论文题目|thesis|dissertation/i, "thesis"],
  [/政治面貌/, "politics"],
  [/籍贯|户口所在地/, "hometown", /地址|详细/],
  [/民族/, "ethnicity"],
  [/微信/, "wechat"],
  [/英文名|英文姓名|englishname/i, "englishName", /拼音|姓氏/],
  [/交换生?经历|海外交换|交换学习|海外(?:学习)?经历/, "exchange", /是否接受|愿意|意向/],
  [/期望(?:月|年)?薪|薪资要求|薪资期望|期望待遇/, "expectedSalary"],
  [/到岗|可入职|最早入职/, "availableFrom"],
  [/实习时长|实习周期|可实习时间/, "internshipDuration"],
  [/通讯地址|联系地址|现住址|居住地址|邮寄地址/, "address"],
  [/意向城市|期望城市|期望工作地|意向工作地|期望工作城市|意向地点/, "preferredCities"],
  [/^country(?:\/?(?:or)?region)?(?:ofresidence)?$|^所在国家|^居住国家|^国家(?:\/|或)?地区$/i, "country"],
  [/现居|所在城市|居住城市|^currentcity$|^city$/i, "currentCity"],
  [/期望岗位|期望职位|意向岗位|意向职位/, "targetRole"],
];

export function profileKeyForLabel(label: string): string | null {
  const text = label.replace(/[\s*＊:：]/g, "");
  for (const [pattern, key, not] of LABEL_KEYS) if (pattern.test(text) && !(not && not.test(text))) return key;
  return null;
}

export type LearnedNotice = { id: string; label: string };

type LearnInput = {
  answers: Array<{ answer: string; profileKey?: string }>;
  records: MemoryCapture[];
  sourceUrl: string;
  /** A 资料方案 is in use: its own internships / projects are not touched. */
  variantActive: boolean;
  /** Extras as the page saw them (a 资料方案's own values over the default). */
  effectiveExtras: Record<string, string>;
  /** 经历记忆库 entries: a capture matching one of these is not new. */
  memories: Array<{ category: string; content: MemoryContent }>;
  now?: Date;
};

export type LearnResult = {
  profile: ApplicationProfile;
  /** Set when the applicant's 期望城市 (a User column) was learned or refined. */
  preferredCities?: string;
  learned: LearnedNotice[];
  consumedAnswers: Set<number>;
  consumedRecords: Set<number>;
  changed: boolean;
};

const rowState = (row: MemoryContent) => JSON.stringify(row);

function rowTitle(category: MemoryCategory, row: MemoryContent) {
  return `${MEMORY_CATEGORIES[category]}「${(row[memoryAnchor(category)] || "").slice(0, 30)}」`;
}

/** Keeps the 撤销 records short: recent ones, at most the schema's 80. */
export function pruneLearned(entries: LearnedEntry[], now = new Date()): LearnedEntry[] {
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000;
  return entries.filter((entry) => Date.parse(entry.at) >= cutoff).slice(-80);
}

/**
 * Writes what a hand-filled page adds to 网申资料: blank 常问字段 (and 期望城市),
 * blanks of a saved row that the page's 经历 matches, and new rows for a list
 * that is still empty — or that only holds rows this same page added. Later
 * captures from that page keep those rows in step. Returns which captures it
 * took, so they are not also put in 待核对.
 */
export function learnFromPage(base: ApplicationProfile, user: { preferredCities: string | null }, input: LearnInput): LearnResult {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const profile: ApplicationProfile = JSON.parse(JSON.stringify(base));
  const learned: LearnedNotice[] = [];
  const consumedAnswers = new Set<number>();
  const consumedRecords = new Set<number>();
  let preferredCities: string | undefined;
  let changed = false;
  const fresh = (entry: LearnedEntry) => now.getTime() - Date.parse(entry.at) < LEARN_SESSION_MS;
  const latest = (match: (entry: LearnedEntry) => boolean) => [...profile.learned].reverse().find(match);
  const notice = (entry: LearnedEntry) => { if (!learned.some((item) => item.id === entry.id)) learned.push({ id: entry.id, label: entry.label }); };
  // A row learned earlier and changed now: its other 撤销 records follow it.
  const retarget = (before: string, after: string) => { for (const item of profile.learned) if (!item.undone && item.state === before && item.kind !== "fact") item.state = after; };
  // Two boxes for one field on a page (研究方向 under 本科 and 硕士): the first one counts.
  const handled = new Set<string>();

  for (const [index, answer] of input.answers.entries()) {
    const key = answer.profileKey;
    if (!key || !Object.hasOwn(LEARNABLE_FACTS, key) || PER_COMPANY.has(key) || handled.has(key)) continue;
    handled.add(key);
    const value = answer.answer.trim();
    if (!value || value.length > 1000 || PLACEHOLDER.test(value)) continue;
    const ref = key === "preferredCities" ? "user:preferredCities" : `extras:${key}`;
    const stored = key === "preferredCities" ? (preferredCities ?? user.preferredCities ?? "") : (profile.extras[key] || "");
    const shown = key === "preferredCities" ? stored : (input.effectiveExtras[key] || stored);
    const entry = latest((item) => item.ref === ref && item.source === input.sourceUrl);
    // Taken back on this very page: from here on it is reviewed as usual.
    if (entry?.undone && fresh(entry)) continue;
    const write = (next: string) => {
      if (key === "preferredCities") preferredCities = next;
      else profile.extras[key] = next;
      changed = true;
    };
    if (!shown.trim()) {
      write(value);
      const created: LearnedEntry = { id: randomUUID(), kind: "fact", ref, label: LEARNABLE_FACTS[key], state: value, added: {}, source: input.sourceUrl, captureKey: "", at, undone: false, seen: true };
      profile.learned.push(created);
      notice(created);
      consumedAnswers.add(index);
    } else if (entry && !entry.undone && fresh(entry) && entry.state === stored) {
      // Learned from this page a moment ago and edited again since.
      if (value !== stored) {
        write(value);
        entry.state = value;
        entry.at = at;
        notice(entry);
      }
      consumedAnswers.add(index);
    }
  }

  for (const [index, record] of input.records.entries()) {
    const category = record.category;
    const content = memoryContent(category, record.content);
    if (!content || content.text) continue;
    if (input.variantActive && (category === "experience" || category === "project")) continue;
    const name = (content[memoryAnchor(category)] || "").trim();
    if (name.length < 2 || PLACEHOLDER.test(name) || NOT_A_NAME.test(name)) continue;
    const { list, limit } = MEMORY_LISTS[category];
    const rows = profile[list] as MemoryContent[];
    const ref = `row:${category}`;
    const cleaned = Object.fromEntries(Object.entries(content).map(([key, value]) => [key, PLACEHOLDER.test(value) ? "" : value]));
    const filled = Object.fromEntries(Object.entries(cleaned).filter(([, value]) => value));

    // A row this page's own block added: keep it in step with the page.
    const own = record.captureKey ? latest((item) => item.kind === "add" && item.ref === ref && item.source === input.sourceUrl && item.captureKey === record.captureKey && fresh(item)) : undefined;
    if (own) {
      if (own.undone) continue;
      const position = rows.findIndex((row) => rowState(row) === own.state);
      // Edited in 网申资料 since: that edit wins; the page goes to 待核对.
      if (position < 0) continue;
      const next = { ...rows[position], ...filled };
      if (rowState(next) !== own.state) {
        rows[position] = next;
        retarget(own.state, rowState(next));
        own.label = rowTitle(category, next);
        own.at = at;
        changed = true;
        notice(own);
      }
      consumedRecords.add(index);
      continue;
    }

    const matches = rows.map((row, i) => (sameMemoryEntity(category, row, content) ? i : -1)).filter((i) => i >= 0);
    if (matches.length === 1) {
      // The same 经历 as a saved row: only its blanks are taken from the page.
      const row = rows[matches[0]];
      const added = Object.fromEntries(Object.entries(filled).filter(([key]) => !row[key]));
      if (Object.keys(added).length) {
        const next = { ...row, ...added };
        rows[matches[0]] = next;
        retarget(rowState(row), rowState(next));
        const created: LearnedEntry = { id: randomUUID(), kind: "fill", ref, label: `${rowTitle(category, next)}的${Object.keys(added).map((key) => FIELD_LABELS[key] || key).join("、")}`, state: rowState(next), added, source: input.sourceUrl, captureKey: record.captureKey || "", at, undone: false, seen: true };
        profile.learned.push(created);
        changed = true;
        notice(created);
      }
      consumedRecords.add(index);
      continue;
    }
    if (matches.length > 1) continue;
    if (input.memories.some((memory) => memory.category === category && sameMemoryEntity(category, memory.content, content))) continue;
    // A new row only where the list is empty, or holds nothing but what this page added.
    const seededHere = rows.length > 0 && rows.every((row) => profile.learned.some((item) => item.kind === "add" && item.ref === ref && item.source === input.sourceUrl && !item.undone && item.state === rowState(row) && fresh(item)));
    if ((rows.length && !seededHere) || rows.length >= limit) continue;
    const row = cleaned;
    rows.push(row);
    const created: LearnedEntry = { id: randomUUID(), kind: "add", ref, label: rowTitle(category, row), state: rowState(row), added: {}, source: input.sourceUrl, captureKey: record.captureKey || "", at, undone: false, seen: true };
    profile.learned.push(created);
    changed = true;
    notice(created);
    consumedRecords.add(index);
  }

  if (changed) profile.learned = pruneLearned(profile.learned, now);
  return { profile, preferredCities, learned, consumedAnswers, consumedRecords, changed };
}

/**
 * 撤销 for what the browser learned. Only takes back what is still exactly
 * as written; anything edited since stays. Either way the entry is marked,
 * so the same page does not write it in again.
 */
export function undoLearned(base: ApplicationProfile, user: { preferredCities: string | null }, ids: string[]) {
  const profile: ApplicationProfile = JSON.parse(JSON.stringify(base));
  let preferredCities: string | null | undefined;
  let undone = 0;
  let kept = 0;
  for (const entry of profile.learned) {
    if (!ids.includes(entry.id) || entry.undone) continue;
    entry.undone = true;
    if (entry.kind === "fact") {
      if (entry.ref === "user:preferredCities") {
        if ((user.preferredCities || "") === entry.state) { preferredCities = null; undone++; } else kept++;
      } else {
        const key = entry.ref.slice("extras:".length);
        if (profile.extras[key] === entry.state) { delete profile.extras[key]; undone++; } else kept++;
      }
      continue;
    }
    const category = entry.ref.slice("row:".length) as MemoryCategory;
    if (!Object.hasOwn(MEMORY_LISTS, category)) { kept++; continue; }
    const rows = profile[MEMORY_LISTS[category].list] as MemoryContent[];
    const index = rows.findIndex((row) => rowState(row) === entry.state);
    if (index < 0) { kept++; continue; }
    if (entry.kind === "add") rows.splice(index, 1);
    else rows[index] = { ...rows[index], ...Object.fromEntries(Object.keys(entry.added).map((key) => [key, ""])) };
    undone++;
  }
  return { profile, preferredCities, undone, kept };
}
