-- CreateTable
CREATE TABLE "CompanyAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAlias_alias_key" ON "CompanyAlias"("alias");

-- CreateIndex
CREATE INDEX "CompanyAlias_companyId_idx" ON "CompanyAlias"("companyId");
