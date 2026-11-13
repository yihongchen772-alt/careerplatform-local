import { identifyApplication, sameCompany, sameJob, withAiAnswer, type Identity, type IdentityPoolPosition, type IdentitySite } from "@/lib/application-identity";
import type { ApplicationSnapshot } from "@/types/desktop-bridge";

export type Recognition = Identity & { usedAi: boolean };

/**
 * Which company and job a submitted 网申 was: the job the tab was bound to,
 * else what the pages and the form say (application-identity.ts), else —
 * only for what is still blank — the AI's reading of the same pages.
 */
export async function recognizeApplication(snapshot: ApplicationSnapshot, pool: IdentityPoolPosition[], sites: IdentitySite[], signal?: AbortSignal): Promise<Recognition> {
  const bound = snapshot.positionId ? pool.find((position) => position.id === snapshot.positionId) : null;
  const input = { url: snapshot.url, title: snapshot.title || "", text: snapshot.text || "", siteName: snapshot.siteName || null, history: snapshot.history || [], fields: snapshot.fields || [], jdText: (snapshot.jdPage?.text || "").slice(0, 4000), jdHeadings: snapshot.jdPage?.headings || [] };
  const found = identifyApplication(input, pool, sites);
  // The job linked while filling — unless these pages name another company or
  // another job: the tab has moved on to the next 网申 since.
  if (bound) {
    const otherCompany = !!found.companyName && !sameCompany(bound.companyName, found.companyName);
    const otherJob = !!found.title && !sameJob(bound.title, found.title);
    if (!otherCompany && !otherJob) return { positionId: bound.id, companyName: bound.companyName, title: bound.title, evidence: ["填写时关联的候选池岗位"], usedAi: false };
  }
  if (found.companyName && found.title) return { ...found, usedAi: false };
  try {
    const res = await fetch("/api/desktop-browser/identify-application", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, known: { companyName: found.companyName, title: found.title } }),
      signal,
    });
    return withAiAnswer(found, res.ok ? await res.json() : {}, pool);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    return { ...found, usedAi: false };
  }
}
