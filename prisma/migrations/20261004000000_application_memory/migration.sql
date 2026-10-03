CREATE TABLE "ApplicationMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "alternatives" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApplicationMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApplicationMemory_userId_category_identity_key" ON "ApplicationMemory"("userId", "category", "identity");
CREATE INDEX "ApplicationMemory_userId_enabled_idx" ON "ApplicationMemory"("userId", "enabled");
