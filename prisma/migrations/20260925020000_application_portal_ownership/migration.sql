ALTER TABLE "ApplicationPortal" ADD COLUMN "lastSuccessfulAt" DATETIME;
UPDATE "ApplicationPortal" SET "lastSuccessfulAt" = "lastCheckedAt" WHERE "lastError" IS NULL;
ALTER TABLE "Application" ADD COLUMN "portalId" TEXT REFERENCES "ApplicationPortal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Preserve the old single-portal behavior for existing applications. Companies
-- with several portals stay unassigned until the user chooses the right one.
UPDATE "Application" SET "portalId" = (
  SELECT "id" FROM "ApplicationPortal" WHERE "companyId" = "Application"."companyId" LIMIT 1
) WHERE (SELECT COUNT(*) FROM "ApplicationPortal" WHERE "companyId" = "Application"."companyId") = 1;
CREATE INDEX "Application_portalId_idx" ON "Application"("portalId");
