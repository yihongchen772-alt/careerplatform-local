-- CreateTable
CREATE TABLE "InterviewNoteExtract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "stageHistoryId" TEXT NOT NULL,
    "questions" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewNoteExtract_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewNoteExtract_stageHistoryId_fkey" FOREIGN KEY ("stageHistoryId") REFERENCES "StageHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewNoteExtract_stageHistoryId_key" ON "InterviewNoteExtract"("stageHistoryId");

-- CreateIndex
CREATE INDEX "InterviewNoteExtract_userId_idx" ON "InterviewNoteExtract"("userId");
