-- AlterTable
ALTER TABLE "User" ADD COLUMN "agentAiProvider" TEXT;
ALTER TABLE "User" ADD COLUMN "agentAiModel" TEXT;
ALTER TABLE "User" ADD COLUMN "agentDailyBrief" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "agentWeeklyReview" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AgentBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentBrief_userId_kind_period_key" ON "AgentBrief"("userId", "kind", "period");
