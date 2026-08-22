/*
  Warnings:

  - You are about to drop the `Reminder` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Reminder" DROP CONSTRAINT "Reminder_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "Reminder" DROP CONSTRAINT "Reminder_userId_fkey";

-- DropTable
DROP TABLE "Reminder";
