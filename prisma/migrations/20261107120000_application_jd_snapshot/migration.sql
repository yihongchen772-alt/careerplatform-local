-- AlterTable
ALTER TABLE "Application" ADD COLUMN "jdSnapshot" TEXT;
ALTER TABLE "Application" ADD COLUMN "jdSnapshotUrl" TEXT;

-- Backfill: records already linked to a 岗位 with a JD keep what it says now.
UPDATE "Application" SET
  "jdSnapshot" = (SELECT p."jdText" FROM "Position" p WHERE p."id" = "Application"."positionId"),
  "jdSnapshotUrl" = (SELECT p."jdUrl" FROM "Position" p WHERE p."id" = "Application"."positionId")
WHERE "positionId" IS NOT NULL AND (SELECT TRIM(COALESCE(p."jdText", '')) FROM "Position" p WHERE p."id" = "Application"."positionId") <> '';
