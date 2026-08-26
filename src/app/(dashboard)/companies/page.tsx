import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AddCompanyDialog } from "@/components/companies/add-company-dialog";
import { CompanyDirectory } from "@/components/companies/company-directory";

export default async function CompaniesPage() {
  await requireUser();

  const companies = await db.company.findMany({
    where: { careerUrl: { not: null } },
    orderBy: [{ verified: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">企业名录</h1>
          <p className="text-sm text-muted-foreground">
            知名企业校招入口，&ldquo;已核实&rdquo;是平台收录并验证过链接可用的条目；&ldquo;用户添加&rdquo;由用户自行提交，请自行甄别。
          </p>
        </div>
        <AddCompanyDialog />
      </div>

      <CompanyDirectory
        companies={companies
          .filter((c) => c.careerUrl)
          .map((c) => ({
            id: c.id,
            name: c.name,
            careerUrl: c.careerUrl as string,
            sector: c.sector,
            industry: c.industry,
            verified: c.verified,
          }))}
      />
    </div>
  );
}
