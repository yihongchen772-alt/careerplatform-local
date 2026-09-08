-- CreateTable
CREATE TABLE "StagePostmortem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "stageHistoryId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StagePostmortem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StagePostmortem_stageHistoryId_fkey" FOREIGN KEY ("stageHistoryId") REFERENCES "StageHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StagePostmortem_stageHistoryId_key" ON "StagePostmortem"("stageHistoryId");

-- CreateIndex
CREATE INDEX "StagePostmortem_userId_idx" ON "StagePostmortem"("userId");
