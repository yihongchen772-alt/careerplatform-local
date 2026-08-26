-- CreateTable: Contact — recruiters/referrers/interviewers worth tracking,
-- separate from Application.referrer (a free-text attribute of one
-- application) since the same person spans multiple applications/rounds.
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "companyName" TEXT,
    "contactInfo" TEXT,
    "note" TEXT,
    "lastContactedAt" DATETIME,
    "nextFollowUpAt" DATETIME,
    "positionId" TEXT,
    "applicationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Contact_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Contact_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Contact_userId_idx" ON "Contact"("userId");
