-- AlterTable: StageHistory gains an optional window end for the next step
ALTER TABLE "StageHistory" ADD COLUMN "nextDeadlineEnd" DATETIME;

-- AlterTable: PersonalTask gains the same optional window end
ALTER TABLE "PersonalTask" ADD COLUMN "dueDateEnd" DATETIME;

-- CreateTable: MailAccount replaces User's single-mailbox scan config
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "passwordEncrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "MailAccount_userId_idx" ON "MailAccount"("userId");

-- Backfill: carry over whatever single mailbox was already configured for
-- scanning, so upgrading doesn't silently stop scanning an inbox someone
-- already set up. Only backfills rows with a complete IMAP config — a user
-- who never turned scanning on has nothing worth migrating.
INSERT INTO "MailAccount" ("id", "userId", "label", "imapHost", "imapPort", "email", "passwordEncrypted", "enabled", "lastCheckedAt", "createdAt")
SELECT
  'mail_' || lower(hex(randomblob(12))),
  "id",
  NULL,
  "imapHost",
  "imapPort",
  "smtpUser",
  "smtpPasswordEncrypted",
  "inboxScanEnabled",
  "lastEmailCheckAt",
  CURRENT_TIMESTAMP
FROM "User"
WHERE "imapHost" IS NOT NULL
  AND "imapPort" IS NOT NULL
  AND "smtpUser" IS NOT NULL
  AND "smtpPasswordEncrypted" IS NOT NULL;

-- Drop the old single-mailbox scan-only columns. smtpHost/smtpPort/smtpUser/
-- smtpPasswordEncrypted/smtpFrom stay on User — those are the *sending*
-- identity for reminder digests, an unrelated concern from which inboxes
-- get scanned.
ALTER TABLE "User" DROP COLUMN "imapHost";
ALTER TABLE "User" DROP COLUMN "imapPort";
ALTER TABLE "User" DROP COLUMN "inboxScanEnabled";
ALTER TABLE "User" DROP COLUMN "lastEmailCheckAt";
