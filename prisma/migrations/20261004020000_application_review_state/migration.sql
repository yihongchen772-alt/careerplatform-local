ALTER TABLE "PendingApplicationChange" ADD COLUMN "variantId" TEXT;
ALTER TABLE "PendingApplicationChange" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "PendingApplicationChange" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
