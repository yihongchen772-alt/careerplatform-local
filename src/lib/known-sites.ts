import { db } from "@/lib/db";
import { siteKey, type KnownSite } from "@/lib/site-key";
import { STAGE_LABELS } from "@/lib/stage-labels";

const TERMINAL = ["REJECTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CANCELLED"];

/**
 * Every company applied to (finished ones too) with every URL known for it —
 * what the 网申浏览器 and the Chrome extension use to say "已投过" and to
 * offer 设为进度页 on a candidate-center page.
 */
export async function loadKnownSites(userId: string): Promise<KnownSite[]> {
  const companies = await db.company.findMany({
    where: { applications: { some: { userId } } },
    select: {
      id: true,
      name: true,
      careerUrl: true,
      portalUrl: true,
      applicationPortals: { select: { url: true } },
      positions: { where: { userId, jdUrl: { not: null } }, select: { jdUrl: true } },
      applications: {
        where: { userId },
        select: { id: true, title: true, currentStage: true, currentStageLabel: true, applyUrl: true },
        orderBy: { appliedDate: "desc" },
      },
    },
  });
  return companies.map((company) => {
    const urls = [
      company.careerUrl,
      company.portalUrl,
      ...company.applicationPortals.map((portal) => portal.url),
      ...company.positions.map((position) => position.jdUrl),
      ...company.applications.map((application) => application.applyUrl),
    ];
    return {
      companyId: company.id,
      companyName: company.name,
      keys: [...new Set(urls.map(siteKey).filter((key): key is string => !!key))],
      portalKeys: [...new Set(company.applicationPortals.map((portal) => siteKey(portal.url)).filter((key): key is string => !!key))],
      applications: company.applications.map((application) => ({
        id: application.id,
        title: application.title,
        stage: application.currentStageLabel || STAGE_LABELS[application.currentStage],
        terminal: TERMINAL.includes(application.currentStage),
      })),
    };
  });
}
