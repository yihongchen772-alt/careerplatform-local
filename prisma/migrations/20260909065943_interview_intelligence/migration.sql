-- AlterTable
ALTER TABLE "InterviewSession" ADD COLUMN "focusMix" TEXT;

-- CreateTable
CREATE TABLE "InterviewIntelligence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InterviewIntelligence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewIntelligence_userId_key" ON "InterviewIntelligence"("userId");
