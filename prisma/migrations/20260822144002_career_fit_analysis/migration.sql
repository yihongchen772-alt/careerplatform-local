-- CreateTable
CREATE TABLE "CareerFitAnalysis" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareerFitAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CareerFitAnalysis_userId_key" ON "CareerFitAnalysis"("userId");

-- AddForeignKey
ALTER TABLE "CareerFitAnalysis" ADD CONSTRAINT "CareerFitAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
