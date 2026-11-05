-- AlterTable
ALTER TABLE "ResumeVersion" ADD COLUMN "structured" JSONB;
ALTER TABLE "ResumeVersion" ADD COLUMN "structuredAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ResumeTailoring" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "positionId" TEXT,
    "resumeVersionId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "draft" JSONB,
    "savedVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResumeTailoring_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResumeTailoring_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResumeTailoring_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResumeTailoring_savedVersionId_fkey" FOREIGN KEY ("savedVersionId") REFERENCES "ResumeVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ResumeTailoring" ("createdAt", "id", "positionId", "result", "resumeVersionId", "updatedAt", "userId") SELECT "createdAt", "id", "positionId", "result", "resumeVersionId", "updatedAt", "userId" FROM "ResumeTailoring";
DROP TABLE "ResumeTailoring";
ALTER TABLE "new_ResumeTailoring" RENAME TO "ResumeTailoring";
CREATE UNIQUE INDEX "ResumeTailoring_savedVersionId_key" ON "ResumeTailoring"("savedVersionId");
CREATE INDEX "ResumeTailoring_userId_idx" ON "ResumeTailoring"("userId");
CREATE INDEX "ResumeTailoring_positionId_resumeVersionId_idx" ON "ResumeTailoring"("positionId", "resumeVersionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

