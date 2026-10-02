-- Add a daily schedule without replacing any existing mailbox or user data.
ALTER TABLE "User" ADD COLUMN "emailReminderEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "emailReminderTime" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "User" ADD COLUMN "emailReminderTimeZone" TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE "User" ADD COLUMN "emailReminderLastDay" TEXT;
ALTER TABLE "User" ADD COLUMN "emailReminderClaimUntil" DATETIME;
ALTER TABLE "User" ADD COLUMN "emailReminderLastSentAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "emailReminderLastError" TEXT;
