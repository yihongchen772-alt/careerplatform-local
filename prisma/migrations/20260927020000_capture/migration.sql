ALTER TABLE "Position" ADD COLUMN "captureKey" TEXT;
ALTER TABLE "Position" ADD COLUMN "recruitmentType" TEXT;
CREATE UNIQUE INDEX "Position_captureKey_key" ON "Position"("captureKey");
