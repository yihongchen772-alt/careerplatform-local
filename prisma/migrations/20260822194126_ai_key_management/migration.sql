-- AlterTable
ALTER TABLE "User" ADD COLUMN "defaultAiProvider" TEXT;

-- CreateTable
CREATE TABLE "AiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AiKey_userId_provider_key" ON "AiKey"("userId", "provider");

-- Carry forward the old single-slot key into the new per-provider table so
-- existing configuration isn't lost, then make it the default.
INSERT INTO "AiKey" ("id", "userId", "provider", "apiKeyEncrypted", "model", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(16))), "id", "aiProvider", "aiApiKeyEncrypted", "aiModel", "createdAt", "createdAt"
FROM "User"
WHERE "aiProvider" IS NOT NULL AND "aiApiKeyEncrypted" IS NOT NULL;

UPDATE "User" SET "defaultAiProvider" = "aiProvider" WHERE "aiProvider" IS NOT NULL;
