// Plain module (client and server): after a 网申 is submitted, work out which
// company and which job it was, from what the browser saw on the way there —
// the job page titles in this tab's history, the form's own 应聘岗位 field,
// the site's address and the success page's wording. Pure and synchronous;
// the AI route only fills what this leaves blank.
import { siteKey } from "@/lib/site-key";

export type IdentityPage = { url: string; title: string };
export type IdentityInput = {
  url: string;
  title: string;
  /** Visible text of the current (success) page. */
  text: string;
  siteName?: string | null;
  /** This tab's pages, oldest first, the current page last. */
  history: IdentityPage[];
  /** Fields read from the submitted form: label + value. */
  fields: { label: string; value: string }[];
};
export type IdentityPoolPosition = { id: string; companyName: string; title: string; jdUrl?: string | null };
/** A company and the siteKey()s of every page known for it. */
export type IdentitySite = { companyName: string; keys: string[] };
export type Identity = {
  positionId?: string;
  companyName: string;
  title: string;
  /** Where each value came from, in words, for the confirmation dialog. */
  evidence: string[];
};
type Field = IdentityInput["fields"][number];

// Navigation and step names: never the employer, never the job.
const PAGE_WORDS = /招聘|官网|首页|主页|职位详情|岗位详情|职位列表|岗位列表|职位搜索|投递|申请|应聘|网申|简历|登录|注册|个人中心|候选人|欢迎|加入我们|\bjoin us\b|\bcareers?\b|\bjobs\b|\bjob (?:details?|search|list(?:ings?|s)?)\b|\bapply\b|\bsign ?in\b|\blog ?in\b|\bhome\b|\bportal\b|\bdetails?\b/i;
const JOB_WORDS = /工程师|经理|专员|分析师|实习生|实习|开发|设计师|设计|运营|产品|管培生|培训生|储备|助理|顾问|研究员|研究|主管|总监|销售|会计|审计|律师|法务|教师|医生|算法|测试|架构师|科学家|分析|策划|编辑|翻译|采购|物流|客服|研发|技术|财务|行政|人力|柜员|交易员|精算|风控|营销|HR|BP|engineer|manager|analyst|intern|developer|designer|specialist|associate|scientist|consultant|officer|coordinator|representative|trainee/i;
// A title segment that is the employer, the site or a page, never the job.
const NOT_A_JOB = /招聘|官网|首页|主页|有限公司|股份|集团|公司$|银行$|证券$|保险$|研究院$|大学$|中心$|careers?$|^jobs?$/i;
// Endings that make a name an organisation even with a job word inside (华为技术有限公司).
// 招商银行信用卡中心, 星海科技上海分公司.
const BRANCH = /(?:有限|公司|集团|银行|证券|保险|电网|移动|电信|联通|控股|股份).*(?:中心|分行|支行|分公司|事业部|事业群)$/;
const COMPANY_SUFFIX = /(?:公司|集团|银行|证券|保险|基金|信托|期货|研究院|研究所|设计院|事务所|科技|技术|控股|医院|学院|大学|实业|物流|汽车|航空|电力|电网|能源|制药|药业|传媒|网络|软件|电子|通信|半导体|股份)$/;
// Recruiting systems and job boards name themselves in titles; they are not the employer.
const PLATFORMS = /^(?:moka|mokahr|北森|italent|beisen|飞书|飞书招聘|feishu|lark|智联|智联招聘|zhaopin|前程无忧|51job|猎聘|liepin|boss|boss直聘|zhipin|牛客|牛客网|nowcoder|实习僧|shixiseng|应届生|应届生求职网|拉勾|拉勾网|lagou|大街|大街网|海投网|国聘|hotjob|大易|wintalent|zhiye|workday|greenhouse|lever|smartrecruiters|icims|taleo|successfactors|linkedin|领英|indeed)$/i;
const NOT_A_NAME = /^(?:社会|校园|实习生?|全球|春季|秋季|春招|秋招|热招|最新|在招|海外|官方|暑期|寒假|应届生?|毕业生|人才|精英|英才|菁英|管培生?|储备|急招|诚聘|职位|岗位|我们|我司|本司|本公司|贵司|贵公司|公司|该公司|社招|校招|全职|兼职|本科|硕士|博士|研究生|大专|不限|远程|急聘|热门|推荐|其他|其它|北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|苏州|天津|重庆|长沙|郑州|青岛|厦门|合肥|济南|宁波|无锡|常州|南通|徐州|扬州|嘉兴|绍兴|金华|温州|台州|佛山|东莞|珠海|中山|惠州|汕头|福州|泉州|南昌|贵阳|昆明|南宁|海口|三亚|太原|石家庄|保定|唐山|沈阳|大连|长春|哈尔滨|呼和浩特|兰州|银川|西宁|乌鲁木齐|拉萨|烟台|潍坊|洛阳|宜昌|襄阳|芜湖|绵阳|香港|澳门|台北|新加坡|全国|中国|国际|海外)$/;
// Form steps and site sections ("个人信息 - 校园招聘").
const STEP_WORDS = /信息|经历|附件|预览|提交|确认|成功|失败|消息|通知|设置|账号|账户|隐私|协议|政策|帮助|说明|指南|公告|新闻|资讯|动态|介绍|关于|联系|搜索|列表|详情|中心|管理|我的|个人|基本|填写|完善|上传|下载|测评|笔试|面试|进度|状态|结果|加载|跳转|验证|提示|错误|出错|不存在|维护|无标题|新标签页|\boffer\b|\bapplications?\b|\brecruit(?:ing|ment)?\b|\bhiring\b|\bsearch\b|\bjobs?\b/i;
const GENERIC_SEGMENT = /^(?:20\d{2}(?:届|年)?)?\s*(?:校园|社会|实习生?|全球|春季|秋季|暑期|海外|人才)?\s*(?:招聘|校招|社招|join us|careers?|jobs)(?:官网|官方网站|网站|主页|首页|门户)?$/i;
const SEGMENT = /\s*[-|_–—·•｜:：]\s*|\s{2,}/;

const STRONG_JOB_FIELD = /应聘(?:岗位|职位)|申请(?:岗位|职位)|投递(?:岗位|职位)|报考(?:岗位|职位)|报名(?:岗位|职位)|第[一1]志愿(?!者)|志愿一|position\s*applied|applied\s*(?:for|position)|applying\s*for|job\s*applied/i;
// Also what the applicant's own internships are labelled — see classifyFields.
const WEAK_JOB_FIELD = /^(?:岗位|职位)(?:名称)?$|^job\s*title$|^position(?:\s*title)?$|^role$/i;
const WISH_FIELD = /意向(?:岗位|职位)|期望(?:岗位|职位)|求职意向|志愿(?:岗位|职位)|第[二三四2-4]志愿|志愿[二三四]|preferred\s*(?:position|role)/i;
const EMPLOYER_FIELD = /应聘(?:单位|公司)|报考单位|报名单位|投递(?:单位|公司)|招聘单位|applying\s*(?:company|to)/i;
const EXPERIENCE_FIELD = /公司|单位|雇主|企业|company|employer|organi[sz]ation/i;

const normalize = (value: string) => String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const includes = (haystack: string, needle: string) => needle.length >= 2 && normalize(haystack).includes(normalize(needle));
/** "星海科技" and "星海科技有限公司" are one employer. */
function sameCompany(a: string, b: string) {
  const [x, y] = [normalize(a), normalize(b)];
  return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x));
}
/** "数据分析师" and "数据分析师（北京）" are one job; "分析" and "数据分析师" are not. */
function sameJob(a: string, b: string) {
  const [x, y] = [normalize(a), normalize(b)];
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && long.includes(short) && short.length / long.length >= 0.5;
}
const segmentsOf = (title: string) => title.split(SEGMENT).map((part) => part.trim()).filter(Boolean);

/** A page's address, for "was this the saved job page": a hash route (#/job/12) is part of it. */
function address(raw: string) {
  const [base, hash = ""] = raw.split("#");
  return base.replace(/\/+$/, "") + (/^[!/]/.test(hash) ? `#${hash}` : "");
}

function cleanCompany(raw: string) {
  let name = raw.replace(/\s+/g, " ").trim().replace(/^(?:欢迎(?:来到|加入|访问|您)?|加入)\s*/, "");
  for (let i = 0; i < 5; i++) name = name.replace(/\s*(?:20\d{2}(?:届|年度?|级)?|春季|秋季|春招|秋招|暑期|寒假|校园|社会|实习生?|全球|海外|官方|官网|高校|应届(?:毕业)?生?|毕业生|提前批|补录|第[一二三四]批|批次|专场|人才|管培生)$/, "");
  return name.replace(/^20\d{2}(?:届|年度?|级)?\s*/, "").trim();
}

/** The employer's name when `raw` can be one, else "". */
function plausibleCompany(raw: string) {
  const name = cleanCompany(raw);
  if (name.length < 2 || name.length > 30 || /届|^\d+$/.test(name)) return "";
  if ((name.match(/[（(]/g) || []).length !== (name.match(/[）)]/g) || []).length) return "";
  if (PLATFORMS.test(normalize(name)) || NOT_A_NAME.test(name) || PAGE_WORDS.test(name)) return "";
  if (COMPANY_SUFFIX.test(name) || BRANCH.test(name)) return name;
  // 朝阳区, 浦东新区: a place, not an employer.
  return !JOB_WORDS.test(name) && !STEP_WORDS.test(name) && !/(?:省|市|区|县|镇)$/.test(name) ? name : "";
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "（2026届校招）" and similar batch tags are not part of the job's name. */
function tidyJob(value: string, companyName: string) {
  let job = value.replace(/[（(【\[][^）)】\]]*(?:届|校招|社招|招聘|批次|20\d{2}|急招|热招|编号)[^）)】\]]*[）)】\]]/g, "");
  // "星海科技 - 数据分析师" / "星海科技的数据分析师", but not 华为 out of 华为云产品经理.
  if (companyName) {
    const name = escapeRegExp(companyName);
    job = job.replace(new RegExp(`^\\s*${name}\\s*(?:[-–—·|｜:：_]|的)\\s*`), "").replace(new RegExp(`\\s*[-–—·|｜:：_]\\s*${name}\\s*$`), "");
  }
  return job.replace(/(?:岗位|职位)(?:详情|申请)?$/, "").replace(/^[\s·\-—:：「“"《【]+|[\s·\-—:：」”"》】]+$/g, "").trim();
}
const plausibleJob = (job: string) => job.length >= 2 && job.length <= 60 && !/^\d+$/.test(job) && !PAGE_WORDS.test(job);

/** "远航集团的管培生" → 管培生; "产品经理（目的地事业部）" stays whole. */
function afterOwner(value: string) {
  const at = value.lastIndexOf("的");
  return at > 0 && !JOB_WORDS.test(value.slice(0, at)) ? value.slice(at + 1) : value;
}

const GREENHOUSE_TITLE = /^job application for (.+?) at (.+)$/i;

/** "数据分析师 - 星海科技校园招聘 | 职位详情" → the segment naming the job. */
function jobFromTitle(title: string, companyName: string) {
  const greenhouse = GREENHOUSE_TITLE.exec(title.trim());
  if (greenhouse && plausibleJob(tidyJob(greenhouse[1], companyName))) return tidyJob(greenhouse[1], companyName);
  for (const segment of segmentsOf(title)) {
    if (segment.length < 2 || segment.length > 40 || NOT_A_JOB.test(segment)) continue;
    if (companyName && includes(segment, companyName) && normalize(segment).length - normalize(companyName).length < 2) continue;
    if (!JOB_WORDS.test(segment)) continue;
    const job = tidyJob(segment, companyName);
    if (plausibleJob(job)) return job;
  }
  return "";
}

/**
 * "星海科技2026校园招聘" / "Careers at Acme" → the employer's name; with
 * `loose`, also the guess from layout: "星海科技 - 校园招聘", "数据分析师 - 星海科技".
 */
function companyFromTitle(title: string, loose: boolean) {
  // Per segment: in "数据分析师（2026届校招） - 星海科技校园招聘" the employer
  // sits in its own part, and the job's part would otherwise match first.
  const greenhouse = GREENHOUSE_TITLE.exec(title.trim());
  if (greenhouse && plausibleCompany(greenhouse[2])) return plausibleCompany(greenhouse[2]);
  const segments = segmentsOf(title);
  for (const segment of segments) {
    const zh = /^(.{2,40}?)(?:招聘|校招|社招)/u.exec(segment);
    const name = zh ? plausibleCompany(zh[1]) : "";
    if (name) return name;
    const en = /(?:careers?|jobs)\s+(?:at|@)\s+([A-Za-z][\w&.\- ]{1,40})$|^([A-Za-z][\w&.\- ]{1,40}?)\s+(?:careers?|jobs|recruiting|recruitment)$/i.exec(segment);
    const english = en ? plausibleCompany(en[1] || en[2]) : "";
    if (english) return english;
  }
  if (!loose) return "";
  // "星海科技 - 校园招聘", "数据分析师 - 星海科技", "投递成功 - 星海科技": beside
  // a generic part, the job or a page name, the one part that can be a name.
  // English parts only beside "Careers" — elsewhere they are often cities.
  const generic = segments.some((segment) => GENERIC_SEGMENT.test(segment));
  const anchored = generic || segments.some((segment) => JOB_WORDS.test(segment) || PAGE_WORDS.test(segment) || STEP_WORDS.test(segment));
  if (!anchored || segments.length < 2 || segments.length > 4) return "";
  const names = segments.filter((segment) => !GENERIC_SEGMENT.test(segment) && (generic || /[\u3400-\u9fff]/.test(segment))).map(plausibleCompany).filter(Boolean);
  return names.length === 1 ? names[0] : "";
}

/** The employer's slug in an ATS address: jobs.lever.co/acme, acme.wd5.myworkdayjobs.com. */
function tenantSlug(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (/(?:^|\.)(?:lever\.co|greenhouse\.io|ashbyhq\.com|smartrecruiters\.com)$/.test(host)) return (url.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
    return /^([a-z0-9-]+)\.(?:wd\d+\.myworkdayjobs\.com|zhiye\.com|jobs\.feishu\.cn|hotjob\.cn|italent\.cn)$/.exec(host)?.[1] ?? "";
  } catch {
    return "";
  }
}

/** "Acme - Graduate Data Analyst" on jobs.lever.co/acme → Acme. */
function companyFromSlug(pages: IdentityPage[], titles: string[]) {
  const slugs = [...new Set(pages.map((page) => tenantSlug(page.url).replace(/[^a-z0-9]/g, "")).filter((slug) => slug.length >= 3 && !/^(?:careers?|jobs?|apply|en|zh|cn|www)$/.test(slug)))];
  if (!slugs.length) return "";
  for (const segment of titles.flatMap(segmentsOf)) {
    const flat = normalize(segment).replace(/[^a-z0-9]/g, "");
    if (flat.length >= 3 && slugs.some((slug) => flat === slug || (flat.length >= 4 && slug.startsWith(flat)) || (slug.length >= 4 && flat.startsWith(slug) && flat.length - slug.length <= 4))) {
      const name = plausibleCompany(segment);
      if (name) return name;
    }
  }
  return "";
}

/** "感谢您申请远航集团的管培生职位" / "感谢您对星海科技的关注" → the employer. */
function companyFromText(text: string) {
  const patterns = [
    /(?:申请了?|投递了?|应聘|加入)\s*([\u3400-\u9fffA-Za-z0-9（）()·&]{2,20}?)的[^，。,\n]{2,30}?(?:职位|岗位)/u,
    /感谢(?:您|你)对\s*([\u3400-\u9fffA-Za-z0-9（）()·&\s]{2,30}?)\s*(?:的)?(?:关注|支持|信任|青睐|认可|兴趣)/u,
    /(?:position|role|job)\s+(?:at|with)\s+([A-Z][\w&.\- ]{1,40}?)\s*[.!,]/,
    /[Tt]hank you for (?:applying|your application|your interest)\s+(?:to|at|in|with)\s+([A-Z][\w&.\- ]{1,40}?)\s*[.!,]/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const name = match ? plausibleCompany(match[1]) : "";
    if (name) return name;
  }
  return "";
}

/** "您已成功投递「数据分析师」岗位" / "投递职位：数据分析师" → 数据分析师. */
function jobFromText(text: string, companyName: string) {
  const sentence = /(?:成功投递|已投递|已申请|申请了?|应聘|投递了?)\s*(?:的)?\s*[「“"《【]?\s*([^」”"》】\n，。,；;]{2,30}?)\s*[」”"》】]?\s*(?:职位|岗位)/.exec(text);
  if (sentence && JOB_WORDS.test(sentence[1])) {
    const job = tidyJob(afterOwner(sentence[1]), companyName);
    if (plausibleJob(job)) return job;
  }
  const labelled = /(?:应聘|申请|投递|报考)(?:的)?(?:岗位|职位)(?:名称)?\s*(?:[:：]|是|为)\s*([^\n，。,；;|！!？?]{2,40}?)(?=\s{2,}|[\n，。,；;|！!？?]|\s+[\u3400-\u9fff]|$)/.exec(text);
  if (labelled) {
    const job = tidyJob(labelled[1], companyName);
    if (plausibleJob(job)) return job;
  }
  const en = /applied\s+(?:for|to)\s+(?:the\s+)?(.{2,60}?)\s+(?:position|role|job)\b|application\s+for\s+(?:the\s+)?(.{2,60}?)\s+(?:position|role)\b|interest\s+in\s+(?:the\s+)?(.{2,60}?)\s+(?:position|role)\b/i.exec(text);
  const english = en ? (en[1] || en[2] || en[3]).trim() : "";
  return english && plausibleJob(english) ? english : "";
}

const fieldLabel = (field: Field) => field.label.replace(/[*＊:：]/g, "").replace(/\s+/g, " ").trim();
const usable = (field: Field) => field.value.trim().length >= 2 && field.value.length <= 80;

/** The submitted form's fields that say which job, or which employer, this was. */
function classifyFields(fields: Field[]) {
  const job: Field[] = [], weak: Field[] = [], wish: Field[] = [], employer: Field[] = [];
  let experience = false;
  for (const field of fields) {
    const label = fieldLabel(field);
    if (STRONG_JOB_FIELD.test(label)) { if (usable(field)) job.push(field); }
    else if (WISH_FIELD.test(label)) { if (usable(field)) wish.push(field); }
    else if (EMPLOYER_FIELD.test(label)) { if (usable(field)) employer.push(field); }
    else if (WEAK_JOB_FIELD.test(label)) { if (usable(field)) weak.push(field); }
    else if (EXPERIENCE_FIELD.test(label)) experience = true;
  }
  // A bare 职位名称 beside a 公司名称 is the applicant's own internship, not this job.
  return { job, wish, employer, weak: weak.length === 1 && !experience ? weak : [] };
}

export function identifyApplication(input: IdentityInput, pool: IdentityPoolPosition[], sites: IdentitySite[]): Identity {
  // The last few pages only: job page → form steps → success. Older pages in
  // the tab are likely another job, and would name it when these don't.
  const pages = [...input.history.filter((page) => /^https?:/i.test(page.url)), { url: input.url, title: input.title }].slice(-10);
  const pageKeys = new Set(pages.map((page) => siteKey(page.url)).filter((key): key is string => !!key));
  // Most recent first: the job page right before the form beats one from earlier.
  const titles = pages.map((page) => page.title).filter(Boolean).reverse();
  const titleText = [...titles, input.siteName || ""].join("\n");
  const fields = classifyFields(input.fields);
  const textHead = input.text.slice(0, 3000);
  const evidence: string[] = [];
  const fromField = (field: Field) => `表单「${fieldLabel(field)}」`;

  let companyName = "";
  // What the pages themselves state, strongest first: the form's 报考单位, a
  // recorded company named in a title, the ATS's own address, the site's
  // name, "X校园招聘" / "Careers at X".
  const namedInTitle = sites.map((site) => site.companyName).concat(pool.map((position) => position.companyName))
    .filter((name) => includes(titleText, name))
    .sort((a, b) => b.length - a.length)[0];
  const stated = ([
    [fields.employer.length ? plausibleCompany(fields.employer[0].value) : "", fields.employer.length ? fromField(fields.employer[0]) : ""],
    [namedInTitle || "", "页面标题里的公司名"],
    [companyFromSlug(pages, titles), "招聘系统网址"],
    [input.siteName ? plausibleCompany(input.siteName.replace(/(?:校园|社会)?招聘(?:官网)?$/, "")) : "", "网站名称"],
    [titles.map((title) => companyFromTitle(title, false)).find(Boolean) || "", "页面标题"],
  ] as [string, string][]).find(([name]) => name);
  // An address alone names the employer when it belongs to one recorded
  // company (on a shared host, the one the pages also name) — unless the
  // pages state another: a recruiting platform it can't tell apart.
  const bySite = [...new Set(sites.filter((site) => site.keys.some((key) => pageKeys.has(key))).map((site) => site.companyName))];
  const siteCompany = bySite.length === 1 ? bySite[0] : bySite.filter((name) => includes(titleText, name)).sort((a, b) => b.length - a.length)[0];
  if (siteCompany && (!stated || sameCompany(siteCompany, stated[0]))) { companyName = siteCompany; evidence.push("网址属于已记录的公司"); }
  else if (stated) { companyName = stated[0]; evidence.push(stated[1]); }
  // Weaker readings, only when nothing above named the employer.
  if (!companyName) {
    for (const title of titles) { const name = companyFromTitle(title, true); if (name) { companyName = name; evidence.push("页面标题"); break; } }
  }
  if (!companyName) { const name = companyFromText(textHead); if (name) { companyName = name; evidence.push("投递成功页的文字"); } }

  let title = "";
  const fromFields = (list: Field[]) => {
    const job = list.length ? tidyJob(list[0].value.trim(), companyName) : "";
    if (plausibleJob(job)) { title = job; evidence.push(fromField(list[0])); }
  };
  fromFields(fields.job);
  if (!title) { const job = jobFromText(textHead, companyName); if (job) { title = job; evidence.push("投递成功页的文字"); } }
  if (!title) {
    for (const pageTitle of titles) { const job = jobFromTitle(pageTitle, companyName); if (job) { title = job; evidence.push("岗位页面的标题"); break; } }
  }
  if (!title) fromFields(fields.weak);
  if (!title) fromFields(fields.wish);

  // A saved candidate-pool job, when this is it: the recognised job at the
  // recognised employer, or — with no job named anywhere — the one whose
  // own page this tab went through.
  const visited = new Set(pages.map((page) => address(page.url)));
  const corpus = [titleText, textHead, ...[...fields.job, ...fields.weak, ...fields.employer].map((field) => field.value)].join("\n");
  const candidates = pool.map((position) => {
    const key = siteKey(position.jdUrl);
    return {
      position,
      exactUrl: !!position.jdUrl && visited.has(address(position.jdUrl)),
      companyHit: (!!key && pageKeys.has(key)) || (!!companyName && sameCompany(position.companyName, companyName)) || includes(corpus, position.companyName),
      titleHit: title ? sameJob(position.title, title) : includes(corpus, position.title),
    };
  });
  const named = candidates.filter((c) => c.titleHit && (c.companyHit || c.exactUrl));
  const viaUrl = named.filter((c) => c.exactUrl);
  const onlyVisited = title ? [] : candidates.filter((c) => c.exactUrl);
  const pick = named.length === 1 ? named[0] : viaUrl.length === 1 ? viaUrl[0] : onlyVisited.length === 1 ? onlyVisited[0] : null;
  if (pick) {
    const why = pick.exactUrl ? "浏览过它的招聘页面" : "页面上出现了这个岗位";
    return { positionId: pick.position.id, companyName: pick.position.companyName, title: pick.position.title, evidence: [...new Set([...evidence, why, "候选池中的岗位"])] };
  }
  return { companyName, title, evidence: [...new Set(evidence)] };
}

/** An answer from elsewhere (the AI), held to the same rules: no platforms, no batch tags. */
export function tidyIdentity(companyName: string | null | undefined, title: string | null | undefined) {
  const company = plausibleCompany(String(companyName || "").slice(0, 120));
  const job = tidyJob(String(title || "").replace(/\s+/g, " ").trim().slice(0, 200), company);
  return { companyName: company, title: plausibleJob(job) ? job : "" };
}

/** Fills what the pages left blank with the AI's reading, then links the pool job it names. */
export function withAiAnswer(found: Identity, ai: { companyName?: string | null; title?: string | null }, pool: IdentityPoolPosition[]): Identity & { usedAi: boolean } {
  const companyName = found.companyName || ai.companyName || "";
  const title = found.title || ai.title || "";
  const usedAi = (!found.companyName && !!ai.companyName) || (!found.title && !!ai.title);
  const evidence = usedAi ? [...found.evidence, "AI 根据页面判断"] : found.evidence;
  const match = companyName && title ? pool.filter((position) => sameCompany(position.companyName, companyName) && sameJob(position.title, title)) : [];
  if (match.length === 1) return { positionId: match[0].id, companyName: match[0].companyName, title: match[0].title, evidence: [...evidence, "候选池中的岗位"], usedAi };
  return { companyName, title, evidence, usedAi };
}

/** Only what helps name the job leaves the device for the AI fallback. */
export function identityFieldsForAi(fields: IdentityInput["fields"]) {
  // Not 公司/单位 in general: on a 网申 form those are the applicant's own internships.
  const { job, weak, wish, employer } = classifyFields(fields);
  const kept = new Set([...job, ...weak, ...wish, ...employer]);
  return fields.filter((field) => kept.has(field) && field.value.length <= 120).slice(0, 12);
}
