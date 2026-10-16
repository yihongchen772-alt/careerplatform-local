import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AddCompanyDialog } from "@/components/companies/add-company-dialog";
import { CompanyDirectory } from "@/components/companies/company-directory";
import { PageHero } from "@/components/layout/page-hero";
import { Building2 } from "lucide-react";

export default async function CompaniesPage() {
  await requireUser();

  const companies = await db.company.findMany({
    where: { careerUrl: { not: null } },
    orderBy: [{ verified: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <PageHero title="企业名录" icon={Building2} description={<>知名企业校招入口，&ldquo;已核实&rdquo;是平台收录并验证过链接可用的条目；&ldquo;用户添加&rdquo;由用户自行提交，请自行甄别。</>} actions={<><AddCompanyDialog /></>} />

      <CompanyDirectory
        companies={companies
          .filter((c) => c.careerUrl)
          .map((c) => ({
            id: c.id,
            name: c.name,
            careerUrl: c.careerUrl as string,
            structuredApiUrl: c.structuredApiUrl,
            sector: c.sector,
            industry: c.industry,
            verified: c.verified,
            radarEnabled: c.radarEnabled,
            radarLastCheckedAt: c.radarLastCheckedAt,
            radarLastChangedAt: c.radarLastChangedAt,
            radarLastError: c.radarLastError,
            radarLastWarning: c.radarLastWarning,
          }))}
      />
    </div>
  );
}
