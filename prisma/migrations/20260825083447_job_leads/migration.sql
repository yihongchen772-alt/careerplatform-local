-- CreateTable
CREATE TABLE "JobLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "track" TEXT,
    "department" TEXT,
    "location" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "deadline" DATETIME,
    "source" TEXT,
    "jdUrl" TEXT,
    "note" TEXT,
    "fitScore" INTEGER,
    "fitReason" TEXT,
    "batch" TEXT,
    "promotedPositionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "JobLead_userId_idx" ON "JobLead"("userId");
