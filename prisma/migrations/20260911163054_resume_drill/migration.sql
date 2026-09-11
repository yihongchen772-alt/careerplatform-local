-- CreateTable
CREATE TABLE "ResumeDrill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "resumeVersionId" TEXT NOT NULL,
    "positionId" TEXT,
    "tree" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResumeDrill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResumeDrill_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResumeDrill_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ResumeDrill_resumeVersionId_key" ON "ResumeDrill"("resumeVersionId");

-- CreateIndex
CREATE INDEX "ResumeDrill_userId_idx" ON "ResumeDrill"("userId");
