-- CreateTable
CREATE TABLE "InterviewRecording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "stageHistoryId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDING',
    "error" TEXT,
    "transcriber" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "chunks" JSONB NOT NULL,
    "transcript" TEXT,
    "review" JSONB,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewRecording_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewRecording_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InterviewRecording_stageHistoryId_fkey" FOREIGN KEY ("stageHistoryId") REFERENCES "StageHistory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "InterviewRecording_userId_idx" ON "InterviewRecording"("userId");
