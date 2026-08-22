-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "addedByUserId" TEXT,
ADD COLUMN     "careerUrl" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
