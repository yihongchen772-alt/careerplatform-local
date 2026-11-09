import { fold, mentions, type MatchableApplication } from "@/lib/mail-application-match";

// The AI sometimes files a real notice under 「无关」. A subject that plainly
// says interview / test / offer AND names a company the user applied to is
// worth a look: it becomes a 「可能相关」 待办, never a stage change.
const STRONG = /面试|笔试|测评|在线测试|机考|录用|offer|interview|assessment|online\s*test|coding\s*test|\bOA\b/i;
const NOISE = /宣讲|招聘会|职位推荐|岗位推荐|为你推荐|订阅|退订|问卷|满意度|newsletter|unsubscribe|webinar|job\s*alert|digest/i;

export type RescuedMail = { type: string; company: string; applicationId: string };

export function rescueMail(mail: { subject: string; from: string; snippet: string }, apps: MatchableApplication[]): RescuedMail | null {
  if (!STRONG.test(mail.subject) || NOISE.test(mail.subject)) return null;
  const raw = `${mail.subject} ${mail.from} ${mail.snippet.slice(0, 300)}`;
  const haystack = fold(raw);
  // Latin names need word boundaries, which folding (spaces removed) loses.
  const spaced = raw.normalize("NFKC").toLowerCase();
  let best: { app: MatchableApplication; length: number } | null = null;
  for (const app of apps) {
    for (const name of [app.companyName, ...(app.aliases ?? [])]) {
      if ((mentions(haystack, name) || mentions(spaced, name)) && (!best || fold(name).length > best.length)) best = { app, length: fold(name).length };
    }
  }
  if (!best) return null;
  return { type: "可能相关的邮件", company: best.app.companyName, applicationId: best.app.id };
}
