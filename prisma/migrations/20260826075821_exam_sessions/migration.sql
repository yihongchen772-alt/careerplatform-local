-- CreateTable
CREATE TABLE "ExamSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "bankId" TEXT,
    "bankName" TEXT NOT NULL,
    "modules" JSONB,
    "questions" JSONB NOT NULL,
    "answers" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "overallScore" INTEGER,
    "summary" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExamSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ExamSession_userId_idx" ON "ExamSession"("userId");
