-- AlterTable
ALTER TABLE "Application" ADD COLUMN "portalStatus" TEXT;
ALTER TABLE "Application" ADD COLUMN "portalStatusAt" DATETIME;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "portalContentHash" TEXT;
ALTER TABLE "Company" ADD COLUMN "portalLastCheckedAt" DATETIME;
ALTER TABLE "Company" ADD COLUMN "portalLastError" TEXT;
ALTER TABLE "Company" ADD COLUMN "portalUrl" TEXT;
