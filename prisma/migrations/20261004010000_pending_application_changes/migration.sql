CREATE TABLE "PendingApplicationChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "contextKey" TEXT,
    "resumeVersionId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PendingApplicationChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PendingApplicationChange_userId_fingerprint_key" ON "PendingApplicationChange"("userId", "fingerprint");
CREATE INDEX "PendingApplicationChange_userId_updatedAt_idx" ON "PendingApplicationChange"("userId", "updatedAt");
