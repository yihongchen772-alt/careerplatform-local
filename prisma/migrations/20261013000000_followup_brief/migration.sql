-- 面完/考完后的跟进：每一步可标记已完成、已跟进；面试速览按投递缓存。
ALTER TABLE "StageHistory" ADD COLUMN "completedAt" DATETIME;
ALTER TABLE "StageHistory" ADD COLUMN "followedUpAt" DATETIME;

CREATE TABLE "InterviewBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewBrief_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InterviewBrief_applicationId_key" ON "InterviewBrief"("applicationId");
CREATE INDEX "InterviewBrief_userId_idx" ON "InterviewBrief"("userId");
