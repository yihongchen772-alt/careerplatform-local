-- AlterTable
ALTER TABLE "Company" ADD COLUMN "structuredApiUrl" TEXT;

-- CreateTable
CREATE TABLE "RadarJobPosting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" DATETIME,
    CONSTRAINT "RadarJobPosting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RadarJobEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RadarJobEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RadarJobPosting_companyId_idx" ON "RadarJobPosting"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RadarJobPosting_companyId_title_key" ON "RadarJobPosting"("companyId", "title");

-- CreateIndex
CREATE INDEX "RadarJobEvent_companyId_idx" ON "RadarJobEvent"("companyId");

-- CreateIndex
CREATE INDEX "RadarJobEvent_createdAt_idx" ON "RadarJobEvent"("createdAt");
