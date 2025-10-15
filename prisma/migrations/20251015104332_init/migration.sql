-- CreateTable
CREATE TABLE "Item" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "examine" TEXT,
    "members" BOOLEAN NOT NULL,
    "limit" INTEGER,
    "value" INTEGER NOT NULL,
    "icon" TEXT,
    "highalch" INTEGER,
    "lowalch" INTEGER
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "highPrice" INTEGER NOT NULL,
    "lowPrice" INTEGER NOT NULL,
    "snapshotTime" DATETIME NOT NULL,
    CONSTRAINT "PriceSnapshot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ItemAnalysis" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "postId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "relevantTextSnippet" TEXT NOT NULL,
    "expectedPriceChange" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ItemAnalysis_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ItemAnalysis_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Item_id_key" ON "Item"("id");

-- CreateIndex
CREATE INDEX "PriceSnapshot_snapshotTime_idx" ON "PriceSnapshot"("snapshotTime");

-- CreateIndex
CREATE UNIQUE INDEX "PriceSnapshot_itemId_snapshotTime_key" ON "PriceSnapshot"("itemId", "snapshotTime");

-- CreateIndex
CREATE UNIQUE INDEX "Post_link_key" ON "Post"("link");

-- CreateIndex
CREATE UNIQUE INDEX "ItemAnalysis_postId_itemId_key" ON "ItemAnalysis"("postId", "itemId");
