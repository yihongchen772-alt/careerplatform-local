import { z } from "zod";
export const applicationRulesSchema = z.object({
  eligibility: z.string().max(10000).default(""), graduationWindow: z.string().max(500).default(""),
  maxPositions: z.number().int().min(1).max(100).nullable().default(null), applicationGroup: z.string().max(200).default(""),
  preferenceOrder: z.string().max(1000).default(""), editPolicy: z.string().max(1000).default(""),
  recruitmentMode: z.enum(["unknown", "fixed", "rolling"]).default("unknown"), deadlineNote: z.string().max(1000).default(""),
  sourceUrl: z.string().max(2000).refine((v) => !v || /^https?:\/\//i.test(v), "公告地址应为网页链接").default(""),
  entryUrl: z.string().max(2000).refine((v) => !v || /^https?:\/\//i.test(v)).default(""), verifiedAt: z.string().datetime().nullable().default(null),
});
export type ApplicationRules = z.infer<typeof applicationRulesSchema>;
