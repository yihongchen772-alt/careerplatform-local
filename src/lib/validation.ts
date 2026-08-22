import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  school: z.string().optional(),
  targetTrack: z.string().optional(),
  graduationYear: z.coerce.number().int().optional(),
  skills: z.string().optional(),
  preferredCities: z.string().optional(),
  expectedSalaryMin: z.coerce.number().int().optional(),
});

export const aiProviderValues = [
  "gemini",
  "openai",
  "deepseek",
  "kimi",
  "anthropic",
] as const;

export const aiSettingsSchema = z.object({
  provider: z.enum(aiProviderValues),
  apiKey: z.string().min(1, "请填写 API Key"),
  model: z.string().optional(),
});

export const emailSettingsSchema = z.object({
  host: z.string().min(1, "请填写 SMTP 服务器地址"),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().email("请填写合法的邮箱地址"),
  password: z.string().min(1, "请填写授权码/应用密码"),
  from: z.string().email().optional(),
  imapHost: z.string().optional(),
  imapPort: z.coerce.number().int().min(1).max(65535).optional(),
  inboxScanEnabled: z.boolean().optional(),
});

export const positionStatusValues = [
  "EVALUATING",
  "PLANNED",
  "APPLIED",
  "DROPPED",
] as const;

export const positionSchema = z.object({
  companyName: z.string().min(1, "公司名称必填"),
  title: z.string().min(1, "岗位名称必填"),
  track: z.string().optional(),
  location: z.string().optional(),
  salaryMin: z.coerce.number().int().optional().nullable(),
  salaryMax: z.coerce.number().int().optional().nullable(),
  jdText: z.string().optional(),
  jdUrl: z.string().optional(),
  source: z.string().optional(),
  deadline: z.coerce.date().optional().nullable(),
  status: z.enum(positionStatusValues).optional(),
  scoreBreakdown: z
    .object({
      techFit: z.number().min(0).max(10),
      salary: z.number().min(0).max(10),
      location: z.number().min(0).max(10),
      growth: z.number().min(0).max(10),
    })
    .partial()
    .optional(),
});

export const applicationStageValues = [
  "APPLIED",
  "SCREENING",
  "OA",
  "INTERVIEW_1",
  "INTERVIEW_2",
  "INTERVIEW_3",
  "HR_INTERVIEW",
  "OFFER",
  "REJECTED",
  "ACCEPTED",
  "DECLINED",
] as const;

export const applicationSchema = z.object({
  positionId: z.string().optional().nullable(),
  companyName: z.string().min(1, "公司名称必填"),
  title: z.string().min(1, "岗位名称必填"),
  appliedDate: z.coerce.date(),
  referrer: z.string().optional(),
  source: z.string().optional(),
  resumeVersionId: z.string().optional().nullable(),
});

export const offerUpdateSchema = z.object({
  salaryMin: z.coerce.number().int().optional().nullable(),
  salaryMax: z.coerce.number().int().optional().nullable(),
  offerNote: z.string().optional(),
});

export const stageUpdateSchema = z.object({
  stage: z.enum(applicationStageValues),
  note: z.string().optional(),
  interviewFormat: z.string().optional(),
  interviewer: z.string().optional(),
  nextDeadline: z.coerce.date().optional().nullable(),
});

export const resumeVersionSchema = z.object({
  name: z.string().min(1, "版本名称必填"),
  fileUrl: z.string().optional(),
  targetTrack: z.string().optional(),
});

export const companyDirectorySectors = [
  "互联网",
  "科技",
  "制造业",
  "金融",
  "物流",
  "消费/服务业",
  "其他",
] as const;

// Lives here rather than beside the action: a "use server" module may only
// export async functions, so a zod object there is a build error.
export const resumeCheckSchema = z.object({
  score: z.number().min(0).max(100),
  completeness: z.number().min(0).max(10),
  quantification: z.number().min(0).max(10),
  clarity: z.number().min(0).max(10),
  summary: z.string(),
  strengths: z.array(z.string()),
  issues: z.array(
    z.object({
      severity: z.enum(["high", "medium", "low"]),
      text: z.string(),
    })
  ),
  suggestions: z.array(z.string()),
});

export type ResumeCheck = z.infer<typeof resumeCheckSchema>;

export const interviewPrepSchema = z.object({
  summary: z.string(),
  focusAreas: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      whatToPrepare: z.string(),
    })
  ),
  likelyQuestionTypes: z.array(z.string()),
});

export type InterviewPrep = z.infer<typeof interviewPrepSchema>;

export const interviewQaSchema = z.object({
  summary: z.string(),
  questions: z.array(
    z.object({
      question: z.string(),
      category: z.string(),
      referenceAnswer: z.string(),
      tips: z.string(),
    })
  ),
});

export type InterviewQa = z.infer<typeof interviewQaSchema>;

export const personalTaskSchema = z.object({
  title: z.string().min(1, "标题必填"),
  note: z.string().optional(),
  dueDate: z.coerce.date().optional().nullable(),
  positionId: z.string().optional().nullable(),
  applicationId: z.string().optional().nullable(),
});

export const startInterviewSessionSchema = z.object({
  resumeVersionId: z.string().min(1),
  positionId: z.string().optional().nullable(),
  targetRole: z.string().optional(),
});

export const sendInterviewMessageSchema = z.object({
  content: z.string().min(1, "先打点字再发送"),
});

export const interviewFeedbackSchema = z.object({
  overallScore: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  summary: z.string(),
});

export type InterviewFeedback = z.infer<typeof interviewFeedbackSchema>;

export const careerFitAnalysisSchema = z.object({
  summary: z.string(),
  recommendedDirections: z.array(
    z.object({
      direction: z.string(),
      reason: z.string(),
    })
  ),
  strengths: z.array(z.string()),
  cautions: z.array(z.string()),
});

export type CareerFitAnalysis = z.infer<typeof careerFitAnalysisSchema>;

export const companyDirectoryEntrySchema = z.object({
  name: z.string().min(1, "公司名称必填"),
  careerUrl: z.string().url("请输入合法的链接"),
  sector: z.enum(companyDirectorySectors).optional(),
  industry: z.string().optional(),
});
