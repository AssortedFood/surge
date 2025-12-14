#!/usr/bin/env node
// tests/matching/benchmark.js
//
// Comprehensive benchmark system for item extraction models.
// Stores results in database with algorithm versioning.
//
// Usage:
//   node tests/matching/benchmark.js                    # Run all configs, 10 runs each
//   node tests/matching/benchmark.js --runs 5           # 5 runs per config
//   node tests/matching/benchmark.js --config o4-mini:low --runs 3
//   node tests/matching/benchmark.js --verbose          # Show FP/FN details per post
//   node tests/matching/benchmark.js --stats            # Show statistics from DB
//   node tests/matching/benchmark.js --stats --config o4-mini:low
//
// Version Control:
//   node tests/matching/benchmark.js --list-versions    # List all algorithm versions
//   node tests/matching/benchmark.js --snapshot         # Snapshot current version
//   node tests/matching/benchmark.js --diff <hash>      # Show diff vs stored version
//   node tests/matching/benchmark.js --restore <hash>   # Restore a previous version
//
// When a new algorithm version is detected (based on hash of core files),
// you will be prompted to enter a label for this version.

import 'dotenv/config';
import { createHash } from 'crypto';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { PrismaClient } from './prisma/generated/client/index.js';
import { cleanPostContent } from '../../src/contentCleaner.js';
import { hybridExtractInline as extractItems } from '../../src/hybridExtractor.js';
import { getSignificantItems } from '../../src/significantItems.js';
import { diffLines } from 'diff';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

// Hash truncation length for algorithm and content hashes
const HASH_LENGTH = 16;

// Benchmark database client (schema defines the db path)
const prisma = new PrismaClient();

/**
 * Computes SHA-256 hash of content (truncated to HASH_LENGTH chars)
 */
function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, HASH_LENGTH);
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Posts with labeled significant items in human-approved.json
// Only posts with at least 1 significant item after pruning
const BENCHMARK_POST_IDS = [3, 5, 7, 8, 15];

// Model configurations to benchmark
const MODEL_CONFIGS = {
  'o4-mini:low': { model: 'o4-mini', reasoning: 'low' },
  'o4-mini:medium': { model: 'o4-mini', reasoning: 'medium' },
  'gpt-5-mini:low': { model: 'gpt-5-mini', reasoning: 'low' },
  'gpt-5-mini:medium': { model: 'gpt-5-mini', reasoning: 'medium' },
};

// Core files that define the algorithm - changes trigger new version
const ALGORITHM_FILES = [
  'src/contentCleaner.js',
  'src/itemValidator.js',
  'src/hybridExtractor.js',
  'src/itemFilter.js',
  'src/significantItems.js',
  'schemas/ItemExtractionSchema.js',
];

// ============================================================================
// ALGORITHM VERSIONING
// ============================================================================

function computeAlgorithmHash() {
  const hash = createHash('sha256');

  for (const file of ALGORITHM_FILES) {
    const filePath = join(__dirname, '../../', file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      hash.update(content);
    }
  }

  return hash.digest('hex').substring(0, HASH_LENGTH);
}

/**
 * Reads all algorithm files and returns a snapshot object
 */
function createSourceSnapshot() {
  const snapshot = {};
  for (const file of ALGORITHM_FILES) {
    const filePath = join(__dirname, '../../', file);
    if (existsSync(filePath)) {
      snapshot[file] = readFileSync(filePath, 'utf-8');
    }
  }
  return snapshot;
}

/**
 * Prompts the user for input via stdin
 * @param {string} question - The question to ask
 * @returns {Promise<string>} - The user's response
 */
function promptUser(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getOrCreateAlgorithm() {
  const hash = computeAlgorithmHash();

  let algorithm = await prisma.benchmarkAlgorithm.findUnique({
    where: { hash },
  });

  if (!algorithm) {
    // New algorithm detected - prompt for label
    console.log(`\nNew algorithm version detected: ${hash}`);
    console.log('Files included in hash:');
    for (const file of ALGORITHM_FILES) {
      console.log(`  - ${file}`);
    }
    console.log('');

    const label = await promptUser('Enter a label for this algorithm version (e.g., "hybrid-v1"): ');

    // Create source snapshot for version restoration
    const snapshot = createSourceSnapshot();

    algorithm = await prisma.benchmarkAlgorithm.create({
      data: {
        hash,
        label: label || null,
        hashedFiles: JSON.stringify(ALGORITHM_FILES),
        sourceSnapshot: JSON.stringify(snapshot),
      },
    });
    console.log(`Created algorithm: ${hash}${label ? ` (${label})` : ''}\n`);
  } else {
    // Backfill snapshot if missing (for existing algorithms)
    if (!algorithm.sourceSnapshot) {
      const snapshot = createSourceSnapshot();
      await prisma.benchmarkAlgorithm.update({
        where: { hash },
        data: { sourceSnapshot: JSON.stringify(snapshot) },
      });
      console.log(`Backfilled snapshot for: ${hash}`);
    }
    console.log(`Using existing algorithm: ${hash}${algorithm.label ? ` (${algorithm.label})` : ''}`);
  }

  return algorithm;
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadFixtures() {
  const postsDir = join(FIXTURES_DIR, 'posts');
  const labelsPath = join(FIXTURES_DIR, 'labels', 'human-approved.json');

  // Load significant items from database cache (auto-recalculates if threshold changes)
  const { items: significantItems, fromCache, threshold } = await getSignificantItems();
  console.log(`Significant items: ${significantItems.length} items ${fromCache ? '(cached)' : '(recalculated)'} - threshold: ${threshold.toLocaleString()} GP`);

  // Build item lookup by name (lowercase) for ground truth filtering
  const significantItemNames = new Set(
    significantItems.map((item) => item.name.toLowerCase())
  );

  const labelsContent = readFileSync(labelsPath, 'utf-8');
  const labels = JSON.parse(labelsContent);
  const groundTruthHash = hashContent(labelsContent);

  const posts = [];
  const labelsByPostId = {};

  // Build a Map of postId -> filename for O(1) lookups
  const postFiles = readdirSync(postsDir);
  const filesByPostId = new Map();
  for (const file of postFiles) {
    const match = file.match(/^(\d+)-/);
    if (match) {
      filesByPostId.set(parseInt(match[1], 10), file);
    }
  }

  let totalLabels = 0;
  let filteredLabels = 0;

  for (const postData of labels.posts) {
    if (!BENCHMARK_POST_IDS.includes(postData.postId)) continue;

    const matchingFile = filesByPostId.get(postData.postId);

    if (matchingFile) {
      const actualPath = join(postsDir, matchingFile);
      const content = readFileSync(actualPath, 'utf-8');
      posts.push({
        id: postData.postId,
        title: postData.postTitle,
        content,
        hash: hashContent(content),
      });

      // Filter ground truth labels to only significant items
      const allLabels = (postData.matches || []).map((m) => m.itemName.toLowerCase());
      const significantLabels = allLabels.filter((name) => significantItemNames.has(name));

      totalLabels += allLabels.length;
      filteredLabels += significantLabels.length;

      labelsByPostId[postData.postId] = significantLabels;
    }
  }

  console.log(`Ground truth: ${filteredLabels}/${totalLabels} items are economically significant`);

  return { posts, significantItems, labelsByPostId, groundTruthHash };
}

// ============================================================================
// EVALUATION
// ============================================================================

/**
 * Calculates precision, recall, and F1 from confusion matrix values
 */
function calculateMetrics(tp, fp, fn) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

function evaluateExtraction(extracted, expected) {
  const extractedSet = new Set(extracted.map((n) => n.toLowerCase()));
  const expectedSet = new Set(expected);

  let tp = 0,
    fp = 0,
    fn = 0;
  const tpItems = [];
  const fpItems = [];
  const fnItems = [];

  for (const item of extractedSet) {
    if (expectedSet.has(item)) {
      tp++;
      tpItems.push(item);
    } else {
      fp++;
      fpItems.push(item);
    }
  }

  for (const item of expectedSet) {
    if (!extractedSet.has(item)) {
      fn++;
      fnItems.push(item);
    }
  }

  return { tp, fp, fn, tpItems, fpItems, fnItems, ...calculateMetrics(tp, fp, fn) };
}

// ============================================================================
// BENCHMARK EXECUTION
// ============================================================================

async function runSingleBenchmark(algorithm, configKey, config, runNumber, posts, significantItems, labelsByPostId, groundTruthHash, verbose = false) {
  const run = await prisma.benchmarkRun.create({
    data: {
      algorithmId: algorithm.id,
      model: config.model,
      reasoningEffort: config.reasoning,
      configKey,
      runNumber,
      groundTruthHash,
    },
  });

  // Process all posts in parallel
  const modelConfig = { model: config.model, reasoning: config.reasoning };

  const postResults = await Promise.all(
    posts.map(async (post) => {
      const cleanedContent = cleanPostContent(post.content);
      const expected = labelsByPostId[post.id] || [];

      try {
        // Call the algorithm - all design decisions are inside the algorithm
        const extractionResult = await extractItems(post.title, cleanedContent, significantItems, modelConfig);

        // Algorithm is responsible for filtering - benchmark just measures output
        const validatedNames = extractionResult.items.map((v) => v.itemName);
        const metrics = evaluateExtraction(validatedNames, expected);

        return {
          runId: run.id,
          postId: post.id,
          postTitle: post.title,
          postHash: post.hash,
          tp: metrics.tp,
          fp: metrics.fp,
          fn: metrics.fn,
          precision: metrics.precision,
          recall: metrics.recall,
          f1: metrics.f1,
          promptTokens: extractionResult.usage.promptTokens,
          completionTokens: extractionResult.usage.completionTokens,
          reasoningTokens: extractionResult.usage.reasoningTokens,
          latencyMs: extractionResult.latencyMs,
          extractedItems: JSON.stringify(validatedNames),
          fpItems: JSON.stringify(metrics.fpItems),
          fnItems: JSON.stringify(metrics.fnItems),
          _metrics: metrics, // Keep for verbose output
        };
      } catch (err) {
        return {
          runId: run.id,
          postId: post.id,
          postTitle: post.title,
          postHash: post.hash,
          tp: 0,
          fp: 0,
          fn: expected.length,
          latencyMs: 0,
          error: err.message,
          _metrics: { fpItems: [], fnItems: [] },
        };
      }
    })
  );

  // Aggregate results
  let totalTp = 0, totalFp = 0, totalFn = 0;
  let totalPromptTokens = 0, totalCompletionTokens = 0, totalReasoningTokens = 0;
  let totalLatencyMs = 0;

  for (const result of postResults) {
    totalTp += result.tp;
    totalFp += result.fp;
    totalFn += result.fn;
    totalPromptTokens += result.promptTokens || 0;
    totalCompletionTokens += result.completionTokens || 0;
    totalReasoningTokens += result.reasoningTokens || 0;
    totalLatencyMs += result.latencyMs || 0;

    // Verbose output for error analysis (after all posts complete)
    if (verbose && (result.fp > 0 || result.fn > 0)) {
      console.log(`\n    Post ${result.postId}: "${result.postTitle.substring(0, 50)}..."`);
      console.log(`      TP: ${result.tp}, FP: ${result.fp}, FN: ${result.fn}`);
      if (result._metrics.fpItems.length > 0) {
        console.log(`      False Positives: ${result._metrics.fpItems.slice(0, 10).join(', ')}${result._metrics.fpItems.length > 10 ? '...' : ''}`);
      }
      if (result._metrics.fnItems.length > 0) {
        console.log(`      False Negatives: ${result._metrics.fnItems.slice(0, 10).join(', ')}${result._metrics.fnItems.length > 10 ? '...' : ''}`);
      }
    }
  }

  // Clean up internal fields before database insert
  const dbResults = postResults.map(({ _metrics, ...rest }) => rest);

  // Batch insert all post results
  await prisma.benchmarkPostResult.createMany({ data: dbResults });

  // Calculate aggregate metrics
  const { precision, recall, f1 } = calculateMetrics(totalTp, totalFp, totalFn);

  await prisma.benchmarkRun.update({
    where: { id: run.id },
    data: {
      completedAt: new Date(),
      totalTp,
      totalFp,
      totalFn,
      precision,
      recall,
      f1,
      totalPromptTokens,
      totalCompletionTokens,
      totalReasoningTokens,
      totalLatencyMs,
    },
  });

  return { runId: run.id, f1, precision, recall, totalLatencyMs };
}

// ============================================================================
// STATISTICS
// ============================================================================

function computeStats(values) {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];

  const p5Index = Math.floor(n * 0.05);
  const p95Index = Math.min(Math.floor(n * 0.95), n - 1);
  const p5 = sorted[p5Index];
  const p95 = sorted[p95Index];

  const min = sorted[0];
  const max = sorted[n - 1];

  const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  return { mean, median, min, max, p5, p95, stdDev, count: n };
}

async function showStatistics(configFilter = null) {
  const where = configFilter ? { configKey: configFilter } : {};

  const runs = await prisma.benchmarkRun.findMany({
    where,
    include: { algorithm: true },
    orderBy: { startedAt: 'desc' },
  });

  if (runs.length === 0) {
    console.log('No benchmark data found.');
    return;
  }

  // Group by algorithm + config
  const groups = {};
  for (const run of runs) {
    const key = `${run.algorithm.hash}|${run.configKey}`;
    if (!groups[key]) {
      groups[key] = {
        algorithmHash: run.algorithm.hash,
        configKey: run.configKey,
        runs: [],
      };
    }
    groups[key].runs.push(run);
  }

  console.log('\n' + '='.repeat(100));
  console.log('BENCHMARK STATISTICS');
  console.log('='.repeat(100));

  for (const group of Object.values(groups)) {
    const f1Values = group.runs.filter((r) => r.f1 !== null).map((r) => r.f1);
    const precisionValues = group.runs.filter((r) => r.precision !== null).map((r) => r.precision);
    const recallValues = group.runs.filter((r) => r.recall !== null).map((r) => r.recall);
    const latencyValues = group.runs.map((r) => r.totalLatencyMs);

    const f1Stats = computeStats(f1Values);
    const precisionStats = computeStats(precisionValues);
    const recallStats = computeStats(recallValues);
    const latencyStats = computeStats(latencyValues);

    const algoLabel = group.runs[0]?.algorithm?.label;
    const algoDisplay = algoLabel ? `${algoLabel} [${group.algorithmHash}]` : group.algorithmHash;
    console.log(`\n${group.configKey} (algorithm: ${algoDisplay})`);
    console.log('-'.repeat(80));
    console.log(`Runs: ${group.runs.length}`);

    if (f1Stats) {
      const pct = (v) => (v * 100).toFixed(1) + '%';
      const ms = (v) => (v / 1000).toFixed(1) + 's';

      console.log(`\n  F1 Score:`);
      console.log(`    Mean: ${pct(f1Stats.mean)}  Median: ${pct(f1Stats.median)}  StdDev: ${pct(f1Stats.stdDev)}`);
      console.log(`    Min: ${pct(f1Stats.min)}  Max: ${pct(f1Stats.max)}  P5: ${pct(f1Stats.p5)}  P95: ${pct(f1Stats.p95)}`);

      console.log(`\n  Precision:`);
      console.log(`    Mean: ${pct(precisionStats.mean)}  Median: ${pct(precisionStats.median)}`);

      console.log(`\n  Recall:`);
      console.log(`    Mean: ${pct(recallStats.mean)}  Median: ${pct(recallStats.median)}`);

      console.log(`\n  Latency (total per run):`);
      console.log(`    Mean: ${ms(latencyStats.mean)}  Median: ${ms(latencyStats.median)}`);
      console.log(`    Min: ${ms(latencyStats.min)}  Max: ${ms(latencyStats.max)}`);
    }
  }

  console.log('\n' + '='.repeat(100));

  // Show per-post statistics
  console.log('\nPER-POST PERFORMANCE (averaged across all runs)');
  console.log('='.repeat(100));

  const postResults = await prisma.benchmarkPostResult.findMany({
    where: configFilter ? { run: { configKey: configFilter } } : {},
    include: { run: { include: { algorithm: true } } },
  });

  // Group by postHash
  const postGroups = {};
  for (const result of postResults) {
    const key = result.postHash;
    if (!postGroups[key]) {
      postGroups[key] = {
        postId: result.postId,
        postTitle: result.postTitle,
        postHash: result.postHash,
        results: [],
      };
    }
    postGroups[key].results.push(result);
  }

  // Calculate and display per-post stats
  const postStats = Object.values(postGroups).map((group) => {
    const f1Values = group.results.filter((r) => r.f1 !== null).map((r) => r.f1);
    const f1Stats = computeStats(f1Values);
    return {
      postId: group.postId,
      postTitle: group.postTitle.substring(0, 40),
      postHash: group.postHash,
      runs: group.results.length,
      meanF1: f1Stats?.mean || 0,
      stdDev: f1Stats?.stdDev || 0,
    };
  });

  // Sort by mean F1 (worst first)
  postStats.sort((a, b) => a.meanF1 - b.meanF1);

  console.log('\nPost ID | Hash             | Runs | Mean F1 | StdDev | Title');
  console.log('-'.repeat(100));
  for (const stat of postStats) {
    const pct = (v) => (v * 100).toFixed(1).padStart(5) + '%';
    console.log(
      `${String(stat.postId).padStart(7)} | ${stat.postHash} | ${String(stat.runs).padStart(4)} | ${pct(stat.meanF1)} | ${pct(stat.stdDev)} | ${stat.postTitle}`
    );
  }

  console.log('\n' + '='.repeat(100));
}

// ============================================================================
// VERSION CONTROL COMMANDS
// ============================================================================

async function listVersions() {
  const algorithms = await prisma.benchmarkAlgorithm.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      runs: {
        select: { f1: true, configKey: true },
      },
    },
  });

  if (algorithms.length === 0) {
    console.log('No algorithm versions found.');
    return;
  }

  console.log('\n' + '='.repeat(100));
  console.log('ALGORITHM VERSIONS');
  console.log('='.repeat(100));
  console.log('\nHash             | Label                | Best F1  | Runs | Has Snapshot | Created');
  console.log('-'.repeat(100));

  for (const algo of algorithms) {
    const f1Values = algo.runs.filter((r) => r.f1 !== null).map((r) => r.f1);
    const bestF1 = f1Values.length > 0 ? Math.max(...f1Values) : null;
    const bestF1Str = bestF1 !== null ? `${(bestF1 * 100).toFixed(1)}%` : 'N/A';
    const hasSnapshot = algo.sourceSnapshot ? 'Yes' : 'No';
    const label = (algo.label || '(none)').substring(0, 20).padEnd(20);
    const date = algo.createdAt.toISOString().split('T')[0];

    console.log(
      `${algo.hash} | ${label} | ${bestF1Str.padStart(7)} | ${String(algo.runs.length).padStart(4)} | ${hasSnapshot.padStart(12)} | ${date}`
    );
  }

  console.log('\n' + '='.repeat(100));
}

async function showDiff(targetHash) {
  const algorithm = await prisma.benchmarkAlgorithm.findUnique({
    where: { hash: targetHash },
  });

  if (!algorithm) {
    console.error(`Algorithm not found: ${targetHash}`);
    process.exit(1);
  }

  if (!algorithm.sourceSnapshot) {
    console.error(`No snapshot available for: ${targetHash}`);
    console.log('This algorithm was created before snapshots were implemented.');
    process.exit(1);
  }

  const storedSnapshot = JSON.parse(algorithm.sourceSnapshot);
  const currentSnapshot = createSourceSnapshot();

  console.log(`\nDiff: current vs ${targetHash}${algorithm.label ? ` (${algorithm.label})` : ''}`);
  console.log('='.repeat(80));

  let hasChanges = false;

  for (const file of ALGORITHM_FILES) {
    const storedContent = storedSnapshot[file] || '';
    const currentContent = currentSnapshot[file] || '';

    if (storedContent === currentContent) {
      console.log(`\n${file}: No changes`);
      continue;
    }

    hasChanges = true;
    console.log(`\n${file}: CHANGED`);
    console.log('-'.repeat(80));

    const diff = diffLines(storedContent, currentContent);
    for (const part of diff) {
      if (part.added) {
        const lines = part.value.split('\n').filter((l) => l);
        for (const line of lines.slice(0, 10)) {
          console.log(`+ ${line}`);
        }
        if (lines.length > 10) console.log(`  ... and ${lines.length - 10} more added lines`);
      } else if (part.removed) {
        const lines = part.value.split('\n').filter((l) => l);
        for (const line of lines.slice(0, 10)) {
          console.log(`- ${line}`);
        }
        if (lines.length > 10) console.log(`  ... and ${lines.length - 10} more removed lines`);
      }
    }
  }

  if (!hasChanges) {
    console.log('\nNo changes between current code and stored version.');
  }
}

async function restoreVersion(targetHash) {
  const algorithm = await prisma.benchmarkAlgorithm.findUnique({
    where: { hash: targetHash },
  });

  if (!algorithm) {
    console.error(`Algorithm not found: ${targetHash}`);
    process.exit(1);
  }

  if (!algorithm.sourceSnapshot) {
    console.error(`No snapshot available for: ${targetHash}`);
    console.log('This algorithm was created before snapshots were implemented.');
    process.exit(1);
  }

  const snapshot = JSON.parse(algorithm.sourceSnapshot);

  console.log(`\nRestoring algorithm: ${targetHash}${algorithm.label ? ` (${algorithm.label})` : ''}`);
  console.log('-'.repeat(60));

  for (const [file, content] of Object.entries(snapshot)) {
    const filePath = join(__dirname, '../../', file);
    writeFileSync(filePath, content);
    console.log(`Restored: ${file}`);
  }

  console.log(`\nSuccessfully restored ${Object.keys(snapshot).length} files.`);
  console.log('Run benchmark to verify the restored version.');
}

async function snapshotCurrent() {
  const hash = computeAlgorithmHash();

  let algorithm = await prisma.benchmarkAlgorithm.findUnique({
    where: { hash },
  });

  const snapshot = createSourceSnapshot();

  if (algorithm) {
    // Update existing with snapshot if missing
    if (!algorithm.sourceSnapshot) {
      await prisma.benchmarkAlgorithm.update({
        where: { hash },
        data: { sourceSnapshot: JSON.stringify(snapshot) },
      });
      console.log(`Snapshot saved for existing algorithm: ${hash}${algorithm.label ? ` (${algorithm.label})` : ''}`);
    } else {
      console.log(`Algorithm already has snapshot: ${hash}${algorithm.label ? ` (${algorithm.label})` : ''}`);
    }
  } else {
    // Create new algorithm with snapshot
    const label = await promptUser('Enter a label for this algorithm version (e.g., "hybrid-v1"): ');

    algorithm = await prisma.benchmarkAlgorithm.create({
      data: {
        hash,
        label: label || null,
        hashedFiles: JSON.stringify(ALGORITHM_FILES),
        sourceSnapshot: JSON.stringify(snapshot),
      },
    });
    console.log(`Created algorithm with snapshot: ${hash}${label ? ` (${label})` : ''}`);
  }

  console.log('\nFiles in snapshot:');
  for (const file of ALGORITHM_FILES) {
    console.log(`  - ${file}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let numRuns = 10;
  let configFilter = null;
  let showStatsMode = false;
  let verboseMode = false;
  let listVersionsMode = false;
  let snapshotMode = false;
  let diffHash = null;
  let restoreHash = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runs' && args[i + 1]) {
      numRuns = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--config' && args[i + 1]) {
      configFilter = args[i + 1];
      i++;
    } else if (args[i] === '--stats') {
      showStatsMode = true;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verboseMode = true;
    } else if (args[i] === '--list-versions') {
      listVersionsMode = true;
    } else if (args[i] === '--snapshot') {
      snapshotMode = true;
    } else if (args[i] === '--diff' && args[i + 1]) {
      diffHash = args[i + 1];
      i++;
    } else if (args[i] === '--restore' && args[i + 1]) {
      restoreHash = args[i + 1];
      i++;
    }
  }

  // Handle version control commands first
  if (listVersionsMode) {
    await listVersions();
    await prisma.$disconnect();
    return;
  }

  if (snapshotMode) {
    await snapshotCurrent();
    await prisma.$disconnect();
    return;
  }

  if (diffHash) {
    await showDiff(diffHash);
    await prisma.$disconnect();
    return;
  }

  if (restoreHash) {
    await restoreVersion(restoreHash);
    await prisma.$disconnect();
    return;
  }

  // Validate --runs argument
  if (isNaN(numRuns) || numRuns < 1) {
    console.error('Invalid --runs value. Must be a positive integer.');
    await prisma.$disconnect();
    process.exit(1);
  }

  if (showStatsMode) {
    await showStatistics(configFilter);
    await prisma.$disconnect();
    return;
  }

  // Validate config before doing any work
  if (configFilter && !MODEL_CONFIGS[configFilter]) {
    console.error(`Unknown config: ${configFilter}`);
    console.log('Available configs:', Object.keys(MODEL_CONFIGS).join(', '));
    await prisma.$disconnect();
    process.exit(1);
  }

  const configsToRun = configFilter ? { [configFilter]: MODEL_CONFIGS[configFilter] } : MODEL_CONFIGS;

  // Run benchmarks
  console.log('Loading fixtures...');
  const { posts, significantItems, labelsByPostId, groundTruthHash } = await loadFixtures();
  console.log(`Loaded ${posts.length} posts, ${significantItems.length} significant items`);
  console.log(`Ground truth hash: ${groundTruthHash}`);

  const algorithm = await getOrCreateAlgorithm();

  const configEntries = Object.entries(configsToRun);
  const totalRuns = configEntries.length * numRuns;
  console.log(`\nRunning ${totalRuns} total runs (${numRuns} runs × ${configEntries.length} configs) in PARALLEL`);
  console.log(`Configs: ${Object.keys(configsToRun).join(', ')}`);
  console.log(`Posts: ${BENCHMARK_POST_IDS.join(', ')}`);
  console.log('');

  // Build all run tasks
  const runTasks = configEntries.flatMap(([configKey, config]) =>
    Array(numRuns).fill().map((_, i) => ({
      configKey,
      config,
      runNumber: i + 1,
    }))
  );

  console.log(`Starting ${runTasks.length} parallel benchmark runs...`);
  const startTime = Date.now();

  // Run ALL configs and runs in parallel
  const allResults = await Promise.all(
    runTasks.map(async ({ configKey, config, runNumber }) => {
      try {
        const result = await runSingleBenchmark(
          algorithm, configKey, config, runNumber,
          posts, significantItems, labelsByPostId, groundTruthHash, verboseMode
        );
        return { configKey, runNumber, result, error: null };
      } catch (err) {
        return { configKey, runNumber, result: null, error: err.message };
      }
    })
  );

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nAll runs completed in ${totalTime}s\n`);

  // Group results by config and display
  const resultsByConfig = {};
  for (const { configKey, runNumber, result, error } of allResults) {
    if (!resultsByConfig[configKey]) resultsByConfig[configKey] = [];
    resultsByConfig[configKey].push({ runNumber, result, error });
  }

  for (const [configKey, runs] of Object.entries(resultsByConfig)) {
    console.log(`${'='.repeat(60)}`);
    console.log(`CONFIG: ${configKey}`);
    console.log('='.repeat(60));

    const successfulRuns = runs.filter(r => r.result);
    const failedRuns = runs.filter(r => r.error);

    for (const { runNumber, result } of successfulRuns) {
      console.log(`  Run ${runNumber}: F1: ${(result.f1 * 100).toFixed(1)}%, Latency: ${(result.totalLatencyMs / 1000).toFixed(1)}s`);
    }
    for (const { runNumber, error } of failedRuns) {
      console.log(`  Run ${runNumber}: ERROR: ${error}`);
    }

    if (successfulRuns.length > 0) {
      const f1Values = successfulRuns.map(r => r.result.f1);
      const stats = computeStats(f1Values);
      console.log(`\n  Summary: Mean F1: ${(stats.mean * 100).toFixed(1)}%, Median: ${(stats.median * 100).toFixed(1)}%, StdDev: ${(stats.stdDev * 100).toFixed(2)}%`);
    }
    console.log('');
  }

  console.log('Benchmark complete. Run with --stats to see full statistics.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
