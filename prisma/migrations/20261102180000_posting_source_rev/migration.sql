-- AlterTable
ALTER TABLE "PostingSource" ADD COLUMN "rev" INTEGER;
ALTER TABLE "PostingSource" ADD COLUMN "lastCheckedAt" DATETIME;
ALTER TABLE "PostingSource" ADD COLUMN "firstSyncedAt" DATETIME;
