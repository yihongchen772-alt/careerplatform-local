-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "size" TEXT,
    "logoUrl" TEXT,
    "careerUrl" TEXT,
    "sector" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "addedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "radarEnabled" BOOLEAN NOT NULL DEFAULT false,
    "radarContentHash" TEXT,
    "radarLastCheckedAt" DATETIME,
    "radarLastChangedAt" DATETIME,
    "radarLastError" TEXT,
    "radarLastWarning" TEXT,
    CONSTRAINT "Company_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Company" ("addedByUserId", "careerUrl", "createdAt", "id", "industry", "logoUrl", "name", "sector", "size", "verified") SELECT "addedByUserId", "careerUrl", "createdAt", "id", "industry", "logoUrl", "name", "sector", "size", "verified" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
