ALTER TABLE "User" ADD COLUMN "autofillMappings" JSONB;
ALTER TABLE "Position" ADD COLUMN "applicationRules" JSONB;
ALTER TABLE "Position" ADD COLUMN "rulesRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Application" ADD COLUMN "submissionPackage" JSONB;
ALTER TABLE "Application" ADD COLUMN "workflowChecklist" JSONB;
ALTER TABLE "Application" ADD COLUMN "workflowRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PersonalTask" ADD COLUMN "mailEventDraft" JSONB;
ALTER TABLE "PersonalTask" ADD COLUMN "mailEventId" TEXT;
ALTER TABLE "AutofillAnswer" ADD COLUMN "contextDigest" TEXT;
CREATE TABLE "ApplicationDraft" (
"id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "contextKey" TEXT NOT NULL, "url" TEXT NOT NULL, "name" TEXT NOT NULL, "content" JSONB NOT NULL, "updatedAt" DATETIME NOT NULL,
CONSTRAINT "ApplicationDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApplicationDraft_userId_contextKey_key" ON "ApplicationDraft"("userId", "contextKey");
