ALTER TABLE "AutofillAnswer" ADD COLUMN "contextKey" TEXT;
CREATE INDEX "AutofillAnswer_userId_resumeVersionId_contextKey_idx" ON "AutofillAnswer"("userId", "resumeVersionId", "contextKey");
