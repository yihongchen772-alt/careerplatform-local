-- CreateEnum
CREATE TYPE "PersonalityTestType" AS ENUM ('OCEAN', 'MBTI', 'DISC', 'HOLLAND');

-- CreateTable
CREATE TABLE "PersonalityTestResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "testType" "PersonalityTestType" NOT NULL,
    "answers" JSONB NOT NULL,
    "scores" JSONB NOT NULL,
    "resultLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalityTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalityTestResult_userId_idx" ON "PersonalityTestResult"("userId");

-- AddForeignKey
ALTER TABLE "PersonalityTestResult" ADD CONSTRAINT "PersonalityTestResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
