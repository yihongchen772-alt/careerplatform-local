-- CreateTable
CREATE TABLE "PostingSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostingSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampusPosting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "roles" TEXT,
    "cohort" TEXT,
    "kind" TEXT,
    "cities" TEXT,
    "industry" TEXT,
    "degree" TEXT,
    "writtenTest" TEXT,
    "applyUrl" TEXT,
    "noticeUrl" TEXT,
    "startDate" DATETIME,
    "deadline" DATETIME,
    "deadlineText" TEXT,
    "note" TEXT,
    "salary" TEXT,
    "positionId" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampusPosting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampusPosting_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PostingSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PostingSource_userId_idx" ON "PostingSource"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CampusPosting_sourceId_externalId_key" ON "CampusPosting"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "CampusPosting_userId_startDate_idx" ON "CampusPosting"("userId", "startDate");

-- CreateIndex
CREATE INDEX "CampusPosting_userId_deadline_idx" ON "CampusPosting"("userId", "deadline");
