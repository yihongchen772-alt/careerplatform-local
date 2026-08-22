-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "name" TEXT,
    "school" TEXT,
    "targetTrack" TEXT,
    "graduationYear" INTEGER,
    "skills" TEXT,
    "preferredCities" TEXT,
    "expectedSalaryMin" INTEGER,
    "emailVerified" DATETIME,
    "image" TEXT,
    "aiProvider" TEXT,
    "aiApiKeyEncrypted" TEXT,
    "aiModel" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPasswordEncrypted" TEXT,
    "smtpFrom" TEXT,
    "imapHost" TEXT,
    "imapPort" INTEGER,
    "inboxScanEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastEmailCheckAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("aiApiKeyEncrypted", "aiModel", "aiProvider", "createdAt", "email", "emailVerified", "expectedSalaryMin", "graduationYear", "id", "image", "name", "passwordHash", "preferredCities", "school", "skills", "smtpFrom", "smtpHost", "smtpPasswordEncrypted", "smtpPort", "smtpUser", "targetTrack") SELECT "aiApiKeyEncrypted", "aiModel", "aiProvider", "createdAt", "email", "emailVerified", "expectedSalaryMin", "graduationYear", "id", "image", "name", "passwordHash", "preferredCities", "school", "skills", "smtpFrom", "smtpHost", "smtpPasswordEncrypted", "smtpPort", "smtpUser", "targetTrack" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
