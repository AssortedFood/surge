-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isAnalyzed" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Post" ("content", "createdAt", "id", "link", "title") SELECT "content", "createdAt", "id", "link", "title" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE UNIQUE INDEX "Post_link_key" ON "Post"("link");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
