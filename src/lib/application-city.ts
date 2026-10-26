/**
 * Which city a 投递 is in. Nothing records it directly: a 岗位 carries a free
 * "工作地点" ("北京市", "广东省-江门", "深圳,上海,北京,长春"), and a 校招 title
 * often says it ("上海校招正式技术 - 算法类", "…（2027届-南京）"). A city set by
 * hand on the 投递 wins over both.
 */

// Cities 校招 postings name most. Longer names first so 苏州太仓 reads as 苏州 + 太仓.
const CITY_NAMES = [
  "北京", "上海", "天津", "重庆",
  "广州", "深圳", "杭州", "南京", "成都", "武汉", "西安", "苏州", "长沙", "郑州", "合肥", "青岛", "宁波", "厦门",
  "东莞", "佛山", "无锡", "济南", "福州", "珠海", "大连", "沈阳", "长春", "哈尔滨", "石家庄", "太原", "南昌", "昆明",
  "贵阳", "南宁", "海口", "兰州", "银川", "西宁", "乌鲁木齐", "呼和浩特", "拉萨", "常州", "南通", "徐州", "温州", "嘉兴",
  "绍兴", "金华", "台州", "湖州", "扬州", "镇江", "泰州", "盐城", "惠州", "中山", "江门", "汕头", "烟台", "潍坊", "洛阳",
  "芜湖", "唐山", "保定", "太仓", "昆山", "吴江", "滨海新区", "雄安", "香港", "澳门", "台北", "新加坡",
].sort((a, b) => b.length - a.length);

// Counties and districts postings use for the city they belong to.
const PARENT: Record<string, string> = { 太仓: "苏州", 昆山: "苏州", 吴江: "苏州", 滨海新区: "天津" };

const REMOTE = ["远程", "全国", "不限"];

export const MULTI_CITY = "多城市";
export const NO_CITY = "未标城市";

/** Three or more places is a choice left to later, not a home for a group of its own. */
const MULTI_FROM = 3;

function scanNames(text: string): string[] {
  const found: { name: string; at: number }[] = [];
  let rest = text;
  for (const name of CITY_NAMES) {
    let at = rest.indexOf(name);
    while (at >= 0) {
      found.push({ name, at });
      // Blank it out so a shorter name inside a longer one is not counted twice.
      rest = `${rest.slice(0, at)}${"\u0000".repeat(name.length)}${rest.slice(at + name.length)}`;
      at = rest.indexOf(name);
    }
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => PARENT[entry.name] ?? entry.name);
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

/** Places named in a 工作地点 / a hand-typed city, in the order written. */
export function parseCities(text: string | null | undefined): string[] {
  const value = (text ?? "").trim();
  if (!value) return [];
  const known = scanNames(value);
  if (known.length) return unique(known);
  // A place we have no list entry for ("鹰潭市", "海外"): keep it as written.
  return unique(
    value
      .split(/[\s/、,，;；|·+&和及]+/)
      .map((part) => part.replace(/^.*[省区]-?/, "").replace(/[市县]$/, "").trim())
      .filter((part) => part.length >= 2 && part.length <= 6 && /^[一-龥]+$/.test(part))
      .concat(REMOTE.filter((word) => value.includes(word))),
  ).slice(0, 12);
}

/** Cities a title names: only ones on the list, since a title is mostly not a place. */
export function citiesInTitle(title: string): string[] {
  return unique(scanNames(title));
}

/** "深圳市雷赛智能控制股份有限公司" is in 深圳; "上海电气" says nothing, so only 「城市+市」 counts. */
export function cityInCompanyName(name: string | null | undefined): string[] {
  const match = (name ?? "").trim().match(/^(.{2,4}?)市/);
  return match ? scanNames(match[1]).slice(0, 1) : [];
}

export type CitySource = { city?: string | null; location?: string | null; title: string; companyName?: string | null };

/** Hand-set city, else the 岗位's location, else what the title says, else the company's own name. */
export function applicationCities(source: CitySource): string[] {
  const manual = parseCities(source.city);
  if (manual.length) return manual;
  const located = parseCities(source.location);
  if (located.length) return located;
  const titled = citiesInTitle(source.title);
  return titled.length ? titled : cityInCompanyName(source.companyName);
}

/** The one group a 投递 sits under when listing by city. */
export function cityGroup(cities: string[]): string {
  if (!cities.length) return NO_CITY;
  return cities.length >= MULTI_FROM ? MULTI_CITY : cities[0];
}

/** "上海" or "北京 · 深圳" or "北京 等 5 城", for a line under the title. */
export function cityText(cities: string[]): string {
  if (!cities.length) return "";
  if (cities.length >= MULTI_FROM) return `${cities[0]} 等 ${cities.length} 城`;
  return cities.join(" · ");
}

/** The cities worth showing under a title: not those the title already says. */
export function cityHint(cities: string[], title: string): string {
  return cityText(cities.filter((name) => !title.includes(name)));
}

// A form box asking where the job is — not where the applicant lives or studied.
const JOB_CITY_LABEL = /(?:应聘|投递|报考|报名|工作|就业|意向|期望|志愿|岗位|职位)[^\s,，、]{0,6}?(?:城市|地点|地区|地域|工作地)|^(?:工作)?(?:城市|地点)$|work\s*location|job\s*location|preferred\s*(?:city|location)/i;
const NOT_JOB_CITY = /现居|居住|户籍|户口|籍贯|出生|生源|家庭|通讯|联系|邮寄|所在|毕业|学校|院校|身份证|常住|住址|入学|学历|参加工作|工作时间|工作经[历验]|实习|兼职|公司|单位|雇主|school|home|birth|resid|address/i;
// "工作地点：上海" in the page's own wording.
const JOB_CITY_TEXT = /(?:工作地点|工作城市|工作地址|工作地|就业地点|招聘城市|招聘地点|work\s*location|job\s*location)\s*[:：]\s*([^\n\r；;。|]{2,40})/i;

/**
 * Where the job is, read from a submitted 网申: the form's own 应聘/意向城市 boxes,
 * else a "工作地点：…" line on the page. Only places on the city list count here —
 * free text in a form is too often something else.
 */
export function cityFromSubmission(fields: { label: string; value: string }[], pageText?: string | null): string[] {
  const named: string[] = [];
  for (const field of fields) {
    const label = field.label.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!JOB_CITY_LABEL.test(label) || NOT_JOB_CITY.test(label)) continue;
    named.push(...scanNames(field.value.normalize("NFKC")));
  }
  if (named.length) return unique(named).slice(0, 6);
  const line = (pageText ?? "").normalize("NFKC").match(JOB_CITY_TEXT);
  return line ? unique(scanNames(line[1])).slice(0, 6) : [];
}
