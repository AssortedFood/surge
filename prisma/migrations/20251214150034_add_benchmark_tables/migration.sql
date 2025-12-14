-- CreateTable
CREATE TABLE "BenchmarkAlgorithm" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "hash" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hashedFiles" TEXT NOT NULL,
    "sourceSnapshot" TEXT
);

-- CreateTable
CREATE TABLE "BenchmarkRun" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "algorithmId" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "reasoningEffort" TEXT,
    "configKey" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "groundTruthHash" TEXT,
    "totalTp" INTEGER NOT NULL DEFAULT 0,
    "totalFp" INTEGER NOT NULL DEFAULT 0,
    "totalFn" INTEGER NOT NULL DEFAULT 0,
    "precision" REAL,
    "recall" REAL,
    "f1" REAL,
    "totalPromptTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCompletionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalReasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "totalLatencyMs" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BenchmarkRun_algorithmId_fkey" FOREIGN KEY ("algorithmId") REFERENCES "BenchmarkAlgorithm" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BenchmarkPostResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" INTEGER NOT NULL,
    "postId" INTEGER NOT NULL,
    "postTitle" TEXT NOT NULL,
    "postHash" TEXT NOT NULL,
    "tp" INTEGER NOT NULL,
    "fp" INTEGER NOT NULL,
    "fn" INTEGER NOT NULL,
    "precision" REAL,
    "recall" REAL,
    "f1" REAL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "error" TEXT,
    "extractedItems" TEXT,
    "fpItems" TEXT,
    "fnItems" TEXT,
    CONSTRAINT "BenchmarkPostResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BenchmarkRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SignificantItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "limit" INTEGER NOT NULL,
    "examine" TEXT,
    "members" BOOLEAN NOT NULL,
    "icon" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkAlgorithm_hash_key" ON "BenchmarkAlgorithm"("hash");

-- CreateIndex
CREATE INDEX "BenchmarkRun_algorithmId_configKey_idx" ON "BenchmarkRun"("algorithmId", "configKey");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkPostResult_runId_postId_key" ON "BenchmarkPostResult"("runId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "SignificantItem_itemId_key" ON "SignificantItem"("itemId");

-- CreateIndex
CREATE INDEX "Post_isAnalyzed_idx" ON "Post"("isAnalyzed");
