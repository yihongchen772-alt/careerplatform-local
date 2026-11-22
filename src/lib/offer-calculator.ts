/**
 * China 2026 After-Tax Net Cash, Housing Fund, Fresh-Grad City Talent Subsidy &
 * Hourly Rate Offer Comparison Calculator (pure deterministic math, 0 external deps).
 */

export type DegreeLevel = "bachelor" | "master" | "phd";

export type CityLivingPreset = {
  city: string;
  /** Social insurance & housing fund cap (monthly RMB, approximate 2026 local cap). */
  insuranceCap: number;
  /** Typical monthly rent for a fresh grad 1BR / decent shared room (RMB). */
  typicalRentMonthly: number;
  /** Fresh-grad living / housing talent subsidy in Year 1 (RMB) by degree (reference). */
  firstYearSubsidy: Record<DegreeLevel, number>;
  subsidyNote: string;
};

export const CITY_LIVING_PRESETS: CityLivingPreset[] = [
  { city: "北京", insuranceCap: 35283, typicalRentMonthly: 4200, firstYearSubsidy: { bachelor: 0, master: 0, phd: 0 }, subsidyNote: "重点看户口指标与公租房" },
  { city: "上海", insuranceCap: 36921, typicalRentMonthly: 4000, firstYearSubsidy: { bachelor: 0, master: 0, phd: 0 }, subsidyNote: "重点看直接落户政策与人才公寓" },
  { city: "深圳", insuranceCap: 36000, typicalRentMonthly: 3200, firstYearSubsidy: { bachelor: 0, master: 10000, phd: 35000 }, subsidyNote: "各区新引进博士/紧缺硕有分期补贴+保租房" },
  { city: "杭州", insuranceCap: 25000, typicalRentMonthly: 2600, firstYearSubsidy: { bachelor: 20000, master: 40000, phd: 110000 }, subsidyNote: "生活补贴(本1万/硕3万/博10万)+租房补贴1万/年" },
  { city: "广州", insuranceCap: 31000, typicalRentMonthly: 2500, firstYearSubsidy: { bachelor: 5000, master: 15000, phd: 40000 }, subsidyNote: "南沙/黄埔等区有新引进人才生活补贴" },
  { city: "苏州", insuranceCap: 24000, typicalRentMonthly: 2000, firstYearSubsidy: { bachelor: 9600, master: 18000, phd: 36000 }, subsidyNote: "姑苏青年人才租房/生活补贴+公积金友好" },
  { city: "南京", insuranceCap: 24000, typicalRentMonthly: 2100, firstYearSubsidy: { bachelor: 7200, master: 9600, phd: 24000 }, subsidyNote: "高校毕业生住房租赁补贴(本600/硕800/博2000/月)" },
  { city: "成都", insuranceCap: 23000, typicalRentMonthly: 1800, firstYearSubsidy: { bachelor: 6000, master: 12000, phd: 24000 }, subsidyNote: "高新/天府新区人才公寓与安家补贴" },
  { city: "武汉", insuranceCap: 21000, typicalRentMonthly: 1700, firstYearSubsidy: { bachelor: 6000, master: 12000, phd: 24000 }, subsidyNote: "光谷/东湖高新人才租房补贴" },
  { city: "西安", insuranceCap: 21000, typicalRentMonthly: 1600, firstYearSubsidy: { bachelor: 3600, master: 7200, phd: 18000 }, subsidyNote: "高新区/高校毕业生安居补贴" },
  { city: "合肥", insuranceCap: 20000, typicalRentMonthly: 1600, firstYearSubsidy: { bachelor: 15000, master: 20000, phd: 36000 }, subsidyNote: "合肥新落户毕业生租房补贴力度大" },
  { city: "重庆", insuranceCap: 20000, typicalRentMonthly: 1500, firstYearSubsidy: { bachelor: 3000, master: 8000, phd: 20000 }, subsidyNote: "生活成本低，性价比高" },
  { city: "长沙", insuranceCap: 19500, typicalRentMonthly: 1500, firstYearSubsidy: { bachelor: 6000, master: 10000, phd: 20000 }, subsidyNote: "房价房租友好+青年人才租房生活补贴" },
  { city: "天津", insuranceCap: 23000, typicalRentMonthly: 1900, firstYearSubsidy: { bachelor: 12000, master: 24000, phd: 36000 }, subsidyNote: "海河英才计划租房/生活补贴" },
];

export function findCityPreset(cityText?: string | null): CityLivingPreset {
  const s = (cityText ?? "").trim();
  const matched = CITY_LIVING_PRESETS.find((c) => s.includes(c.city));
  return matched ?? {
    city: s || "其他城市",
    insuranceCap: 22000,
    typicalRentMonthly: 2000,
    firstYearSubsidy: { bachelor: 0, master: 0, phd: 0 },
    subsidyNote: "可按当地政策手动微调房租与补贴",
  };
}

/** Standard China 7-bracket annual comprehensive individual income tax. */
export function calcAnnualComprehensiveTax(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  const brackets: Array<[number, number, number]> = [
    [36000, 0.03, 0],
    [144000, 0.1, 2520],
    [300000, 0.2, 16920],
    [420000, 0.25, 31920],
    [660000, 0.3, 52920],
    [960000, 0.35, 85920],
    [Infinity, 0.45, 181920],
  ];
  for (const [limit, rate, quick] of brackets) {
    if (taxableIncome <= limit) return Math.max(0, Math.round(taxableIncome * rate - quick));
  }
  return 0;
}

/** China standalone annual bonus tax (dividing by 12 to pick monthly bracket). */
export function calcStandaloneBonusTax(bonus: number): number {
  if (bonus <= 0) return 0;
  const monthly = bonus / 12;
  const brackets: Array<[number, number, number]> = [
    [3000, 0.03, 0],
    [12000, 0.1, 210],
    [25000, 0.2, 1410],
    [35000, 0.25, 2660],
    [55000, 0.3, 4410],
    [80000, 0.35, 7160],
    [Infinity, 0.45, 15160],
  ];
  for (const [limit, rate, quick] of brackets) {
    if (monthly <= limit) return Math.max(0, Math.round(bonus * rate - quick));
  }
  return 0;
}

export type OfferCalcInput = {
  id: string;
  companyName: string;
  title: string;
  city: string;
  /** Base monthly salary in RMB (e.g. 25000). */
  monthlyBase: number;
  /** Total salary months (e.g. 15 means 12 base + 3 bonus). */
  months: number;
  /** Year-1 sign-on bonus or cash allowance (RMB). */
  signOnBonus: number;
  /** Housing fund personal rate (e.g. 0.12 = 12%, company matches equal). */
  housingFundRate: number;
  /** Monthly special tax deduction (e.g. 1500 rent deduction). */
  monthlyDeduction: number;
  /** Monthly rent cost (RMB). */
  monthlyRent: number;
  /** First-year local fresh-grad talent subsidy (RMB). */
  talentSubsidy: number;
  /** Weekly actual work hours (e.g. 45 / 55 / 60). */
  weeklyHours: number;
  /** One-way commute minutes. */
  commuteMinutes: number;
  /** Optional decision deadline (YYYY-MM-DD). */
  decideBy?: string | null;
  /** Optional tripartite default penalty (RMB). */
  penaltyRmb?: number;
};

export type OfferCalcResult = {
  grossAnnual: number;
  personalSocialAndFundAnnual: number;
  companyHousingFundAnnual: number;
  totalHousingFundAnnual: number;
  incomeTaxAnnual: number;
  taxStrategy: "年终奖单独计税更省" | "并入综合所得更省";
  netCashAnnual: number;
  /** Net cash + full dual-side housing fund + talent subsidy - annual rent. */
  realDisposablePlusFund: number;
  /** Net cash + talent subsidy - annual rent (pure cash savings potential). */
  cashAfterRent: number;
  /** Total annual working + commuting hours (50 working weeks). */
  annualWorkAndCommuteHours: number;
  /** Effective hourly rate in RMB/hour based on realDisposablePlusFund. */
  effectiveHourlyRate: number;
};

export function calculateOfferEconomics(input: OfferCalcInput): OfferCalcResult {
  const preset = findCityPreset(input.city);
  const base = Math.max(0, input.monthlyBase);
  const months = Math.max(12, input.months);
  const bonus = Math.max(0, Math.round(base * (months - 12))) + Math.max(0, input.signOnBonus);
  const baseAnnual = Math.round(base * 12);
  const grossAnnual = baseAnnual + bonus;

  // Personal social insurance (8% pension + 2% medical + 0.5% unemployment = 10.5%) + housing fund
  const insBase = Math.min(base, preset.insuranceCap);
  const fundRate = Math.min(0.12, Math.max(0.05, input.housingFundRate));
  const personalSocialMonthly = insBase * 0.105;
  const personalFundMonthly = insBase * fundRate;
  const personalSocialAndFundAnnual = Math.round((personalSocialMonthly + personalFundMonthly) * 12);
  const companyHousingFundAnnual = Math.round(personalFundMonthly * 12);
  const totalHousingFundAnnual = companyHousingFundAnnual * 2;

  const annualDeductions = 60000 + personalSocialAndFundAnnual + Math.max(0, input.monthlyDeduction) * 12;

  // Compare standalone bonus taxation vs merged taxation and pick the lower tax automatically
  const taxStandalone =
    calcAnnualComprehensiveTax(baseAnnual - annualDeductions) + calcStandaloneBonusTax(bonus);
  const taxMerged = calcAnnualComprehensiveTax(grossAnnual - annualDeductions);
  const useStandalone = bonus > 0 && taxStandalone <= taxMerged;
  const incomeTaxAnnual = useStandalone ? taxStandalone : taxMerged;

  const netCashAnnual = Math.max(0, grossAnnual - personalSocialAndFundAnnual - incomeTaxAnnual);
  const annualRent = Math.max(0, input.monthlyRent) * 12;
  const subsidy = Math.max(0, input.talentSubsidy);
  const cashAfterRent = netCashAnnual + subsidy - annualRent;
  const realDisposablePlusFund = cashAfterRent + totalHousingFundAnnual;

  const weeklyCommuteHours = (Math.max(0, input.commuteMinutes) * 2 * 5) / 60;
  const annualWorkAndCommuteHours = Math.max(1, Math.round((Math.max(30, input.weeklyHours) + weeklyCommuteHours) * 50));
  const effectiveHourlyRate = Math.round(realDisposablePlusFund / annualWorkAndCommuteHours);

  return {
    grossAnnual,
    personalSocialAndFundAnnual,
    companyHousingFundAnnual,
    totalHousingFundAnnual,
    incomeTaxAnnual,
    taxStrategy: useStandalone ? "年终奖单独计税更省" : "并入综合所得更省",
    netCashAnnual,
    realDisposablePlusFund,
    cashAfterRent,
    annualWorkAndCommuteHours,
    effectiveHourlyRate,
  };
}
