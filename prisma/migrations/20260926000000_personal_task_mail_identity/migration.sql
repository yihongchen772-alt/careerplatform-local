ALTER TABLE "PersonalTask" ADD COLUMN "sourceMailKey" TEXT;
CREATE UNIQUE INDEX "PersonalTask_sourceMailKey_key" ON "PersonalTask"("sourceMailKey");
