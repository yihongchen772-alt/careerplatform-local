-- AlterTable: MailAccount gains the real de-dup cursor. lastCheckedAt alone
-- can't do this — IMAP's SEARCH SINCE only has day granularity, so two
-- scans on the same calendar day both re-match everything since midnight
-- and re-create a 待办 for mail already processed earlier that day.
ALTER TABLE "MailAccount" ADD COLUMN "lastSeenUid" INTEGER;
