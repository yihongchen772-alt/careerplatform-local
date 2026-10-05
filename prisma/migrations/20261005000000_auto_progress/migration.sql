ALTER TABLE "User" ADD COLUMN "autoApplyProgress" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Application" ADD COLUMN "autoUndoneStatus" TEXT;
ALTER TABLE "StageHistory" ADD COLUMN "autoSource" TEXT;
ALTER TABLE "StageHistory" ADD COLUMN "autoEvidence" TEXT;
ALTER TABLE "StageHistory" ADD COLUMN "autoSeenAt" DATETIME;
