export type StoredFieldMapping = {
  contextKey: string;
  fieldKey: string;
  ref: string;
  atsFamily?: string;
};

const FAMILY_RULES: { family: string; pattern: RegExp }[] = [
  { family: "moka", pattern: /(?:^|\.)mokahr\.com$/i },
  { family: "beisen", pattern: /(?:^|\.)(?:beisen\.com|zhiye\.com|italent\.cn)$/i },
  { family: "feishu", pattern: /(?:^|\.)(?:feishu\.cn|larksuite\.com|jobs\.bytedance\.com|bytedance\.jobs\.feishu\.cn)$/i },
  { family: "dayee", pattern: /(?:^|\.)(?:dayee\.com|hotjob\.cn)$/i },
  { family: "nowcoder", pattern: /(?:^|\.)nowcoder\.com$/i },
  { family: "shixiseng", pattern: /(?:^|\.)shixiseng\.com$/i },
  { family: "51job", pattern: /(?:^|\.)51job\.com$/i },
  { family: "zhaopin", pattern: /(?:^|\.)zhaopin\.com$/i },
  { family: "liepin", pattern: /(?:^|\.)liepin\.com$/i },
  { family: "lagou", pattern: /(?:^|\.)lagou\.com$/i },
  { family: "workday", pattern: /(?:^|\.)(?:myworkdayjobs|workdayjobs)\.com$/i },
  { family: "greenhouse", pattern: /(?:^|\.)greenhouse\.io$/i },
  { family: "lever", pattern: /(?:^|\.)lever\.co$/i },
];

/** Non-sensitive scalar profile references safe to reuse across different portals using the same ATS software. */
export const SAFE_CROSS_TENANT_REF =
  /^(?:name|gender|birthDate|currentCity|country|nationality|englishName|exchange|targetRole|selfIntro|politics|hometown|ethnicity|english|expectedSalary|availableFrom|internshipDuration|researchDirection|researchTopic|rank|acceptAdjust|jobSource|courses|homepage|lab|hobbies|thesis|partyDate|birthplace|householdPlace|householdType|sourcePlace|archivePlace|marital|health|height|weight|colorVision|onlyChild|religion|firstWorkDate|computerLevel|certificates|campusZone|failedCourses|advisor|employmentStatus|workYears|noticePeriod)$/;

export function atsFamilyFor(rawInput: string | null | undefined): string | null {
  if (!rawInput) return null;
  let candidate = String(rawInput).trim();
  if (!candidate) return null;
  if (candidate.startsWith("ats:v1:")) {
    return candidate.slice("ats:v1:".length) || null;
  }
  candidate = candidate.replace(/^(?:page:v2:|tenant:v2:)/, "");
  let host = "";
  try {
    host = new URL(candidate).hostname.toLowerCase();
  } catch {
    const match = /([a-z0-9.-]+\.[a-z]{2,})/i.exec(candidate);
    if (match) host = match[1].toLowerCase();
  }
  if (!host) return null;
  for (const rule of FAMILY_RULES) {
    if (rule.pattern.test(host)) return rule.family;
  }
  return null;
}

/**
 * Returns exact-scope mappings first, then enriches any unmapped `fieldKey`
 * from learned safe mappings saved on other portals of the same ATS vendor
 * family (e.g., another Moka/Beisen/Feishu/Dayee portal).
 */
export function mergeMappingsWithAtsFallback(
  rawMappings: unknown,
  contextKey: string,
  pageUrl?: string | null
): (StoredFieldMapping & { inheritedFromFamily?: string })[] {
  if (!Array.isArray(rawMappings)) return [];
  const items = rawMappings.filter(
    (m): m is StoredFieldMapping =>
      !!m &&
      typeof m === "object" &&
      !Array.isArray(m) &&
      typeof (m as StoredFieldMapping).contextKey === "string" &&
      typeof (m as StoredFieldMapping).fieldKey === "string" &&
      typeof (m as StoredFieldMapping).ref === "string"
  );

  const byFieldKey = new Map<string, StoredFieldMapping & { inheritedFromFamily?: string }>();
  // Walk newest -> oldest so newer user corrections win on duplicate keys.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.contextKey === contextKey && !byFieldKey.has(item.fieldKey)) {
      byFieldKey.set(item.fieldKey, item);
    }
  }

  const family = atsFamilyFor(pageUrl) || atsFamilyFor(contextKey);
  if (family) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.contextKey === contextKey || byFieldKey.has(item.fieldKey)) continue;
      if (!SAFE_CROSS_TENANT_REF.test(item.ref)) continue;
      const itemFamily = item.atsFamily || atsFamilyFor(item.contextKey);
      if (itemFamily === family) {
        byFieldKey.set(item.fieldKey, { ...item, contextKey, inheritedFromFamily: family });
      }
    }
  }

  return [...byFieldKey.values()];
}
