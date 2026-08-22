-- AlterTable
ALTER TABLE "User" ADD COLUMN "smtpFrom" TEXT;
ALTER TABLE "User" ADD COLUMN "smtpHost" TEXT;
ALTER TABLE "User" ADD COLUMN "smtpPasswordEncrypted" TEXT;
ALTER TABLE "User" ADD COLUMN "smtpPort" INTEGER;
ALTER TABLE "User" ADD COLUMN "smtpUser" TEXT;
