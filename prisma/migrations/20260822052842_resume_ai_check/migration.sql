-- AlterTable
ALTER TABLE "ResumeVersion" ADD COLUMN     "checkResult" JSONB,
ADD COLUMN     "checkScore" INTEGER,
ADD COLUMN     "checkedAt" TIMESTAMP(3);
