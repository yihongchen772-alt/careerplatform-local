-- 面试安排：下一步可以带具体时刻、会议链接/地点和提醒；有时刻的安排在日历里
-- 有一份跟随它的事项（提醒靠它发）；邮件识别自动写入的时间可撤销。
ALTER TABLE "StageHistory" ADD COLUMN "nextHasTime" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StageHistory" ADD COLUMN "meetingInfo" TEXT;
ALTER TABLE "StageHistory" ADD COLUMN "remindMinutes" INTEGER;
ALTER TABLE "StageHistory" ADD COLUMN "scheduleSource" TEXT;

ALTER TABLE "CalendarEvent" ADD COLUMN "stageHistoryId" TEXT REFERENCES "StageHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD COLUMN "meetingInfo" TEXT;
ALTER TABLE "CalendarEvent" ADD COLUMN "source" TEXT;
CREATE UNIQUE INDEX "CalendarEvent_stageHistoryId_key" ON "CalendarEvent"("stageHistoryId");

ALTER TABLE "PersonalTask" ADD COLUMN "mailAppliedAt" DATETIME;
ALTER TABLE "PersonalTask" ADD COLUMN "mailUndo" JSONB;
ALTER TABLE "PersonalTask" ADD COLUMN "mailAppliedSeenAt" DATETIME;
ALTER TABLE "PersonalTask" ADD COLUMN "mailUndoneAt" DATETIME;
