-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "offerNote" TEXT,
ADD COLUMN     "salaryMax" INTEGER,
ADD COLUMN     "salaryMin" INTEGER;

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "stageHistoryId" TEXT,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attachment_userId_idx" ON "Attachment"("userId");

-- CreateIndex
CREATE INDEX "Attachment_applicationId_idx" ON "Attachment"("applicationId");

-- CreateIndex
CREATE INDEX "Attachment_stageHistoryId_idx" ON "Attachment"("stageHistoryId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_stageHistoryId_fkey" FOREIGN KEY ("stageHistoryId") REFERENCES "StageHistory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
