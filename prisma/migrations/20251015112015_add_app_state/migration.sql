-- CreateTable
CREATE TABLE "AppState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AppState_key_key" ON "AppState"("key");
