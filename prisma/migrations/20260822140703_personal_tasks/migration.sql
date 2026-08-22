-- CreateTable
CREATE TABLE "PersonalTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "dueDate" TIMESTAMP(3),
    "done" BOOLEAN NOT NULL DEFAULT false,
    "positionId" TEXT,
    "applicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalTask_userId_idx" ON "PersonalTask"("userId");

-- AddForeignKey
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
