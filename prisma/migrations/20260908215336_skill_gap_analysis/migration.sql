-- CreateTable
CREATE TABLE "SkillGapAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "resumeVersionId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillGapAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillGapAnalysis_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SkillGapAnalysis_resumeVersionId_key" ON "SkillGapAnalysis"("resumeVersionId");

-- CreateIndex
CREATE INDEX "SkillGapAnalysis_userId_idx" ON "SkillGapAnalysis"("userId");
