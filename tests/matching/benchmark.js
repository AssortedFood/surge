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
//   node tests/matching/benchmark.js --stats            # Show statistics from DB
//   node tests/matching/benchmark.js --stats --config o4-mini:low
//
// Uses hybrid extraction (LLM + algorithmic with LLM validation) by default.

import 'dotenv/config';
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { cleanPostContent } from '../../src/contentCleaner.js';
import { hybridExtract } from '../../src/hybridExtractor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

// Use separate database for benchmarks
const BENCHMARK_DB_PATH = join(__dirname, '../../prisma/benchmark.db');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${BENCHMARK_DB_PATH}`,
    },
  },
});

/**
 * Computes SHA-256 hash of content (first 16 chars)
 */
function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// 7 diverse posts selected for comprehensive testing
// Excludes posts with 0 items (Post 2) - can't measure F1 with no ground truth
const BENCHMARK_POST_IDS = [3, 5, 6, 7, 8, 12, 15];

// Model configurations to benchmark
const MODEL_CONFIGS = {
  'o4-mini:low': { model: 'o4-mini', reasoning: 'low' },
  'o4-mini:medium': { model: 'o4-mini', reasoning: 'medium' },
  'gpt-5-mini:low': { model: 'gpt-5-mini', reasoning: 'low' },
  'gpt-5-mini:medium': { model: 'gpt-5-mini', reasoning: 'medium' },
};

// Core files that define the algorithm - changes trigger new version
const ALGORITHM_FILES = [
  'src/itemExtractor.js',
  'src/contentCleaner.js',
  'src/itemValidator.js',
  'src/hybridExtractor.js',
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

  return hash.digest('hex').substring(0, 16); // First 16 chars
}

async function getOrCreateAlgorithm(description = null) {
  const hash = computeAlgorithmHash();

  let algorithm = await prisma.benchmarkAlgorithm.findUnique({
    where: { hash },
  });

  if (!algorithm) {
    algorithm = await prisma.benchmarkAlgorithm.create({
      data: {
        hash,
        description,
        hashedFiles: JSON.stringify(ALGORITHM_FILES),
      },
    });
    console.log(`Created new algorithm version: ${hash}`);
  } else {
    console.log(`Using existing algorithm version: ${hash}`);
  }

  return algorithm;
}

// ============================================================================
// DATA LOADING
// ============================================================================

async function loadFixtures() {
  const postsDir = join(FIXTURES_DIR, 'posts');
  const labelsPath = join(FIXTURES_DIR, 'labels', 'human-approved.json');
  const itemsPath = join(FIXTURES_DIR, 'items.json');

  const labels = JSON.parse(readFileSync(labelsPath, 'utf-8'));
  const items = JSON.parse(readFileSync(itemsPath, 'utf-8'));

  const posts = [];
  const labelsByPostId = {};

  // Get list of post files
  const { readdirSync } = await import('fs');
  const postFiles = readdirSync(postsDir);

  for (const postData of labels.posts) {
    if (!BENCHMARK_POST_IDS.includes(postData.postId)) continue;

    // Find actual file matching this post ID
    const prefix = String(postData.postId).padStart(2, '0') + '-';
    const matchingFile = postFiles.find((f) => f.startsWith(prefix));

    if (matchingFile) {
      const actualPath = join(postsDir, matchingFile);
      const content = readFileSync(actualPath, 'utf-8');
      posts.push({
        id: postData.postId,
        title: postData.postTitle,
        content,
        hash: hashContent(content),
      });
    }

    labelsByPostId[postData.postId] = (postData.matches || []).map((m) => m.itemName.toLowerCase());
  }

  return { posts, items, labelsByPostId };
}

// ============================================================================
// EVALUATION
// ============================================================================

function evaluateExtraction(extracted, expected) {
  const extractedSet = new Set(extracted.map((n) => n.toLowerCase()));
  const expectedSet = new Set(expected);

  let tp = 0,
    fp = 0,
    fn = 0;

  for (const item of extractedSet) {
    if (expectedSet.has(item)) {
      tp++;
    } else {
      fp++;
    }
  }

  for (const item of expectedSet) {
    if (!extractedSet.has(item)) {
      fn++;
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { tp, fp, fn, precision, recall, f1 };
}

// ============================================================================
// BENCHMARK EXECUTION
// ============================================================================

async function runSingleBenchmark(algorithm, configKey, config, runNumber, posts, items, labelsByPostId) {
  const run = await prisma.benchmarkRun.create({
    data: {
      algorithmId: algorithm.id,
      model: config.model,
      reasoningEffort: config.reasoning,
      configKey,
      runNumber,
    },
  });

  let totalTp = 0,
    totalFp = 0,
    totalFn = 0;
  let totalPromptTokens = 0,
    totalCompletionTokens = 0,
    totalReasoningTokens = 0;
  let totalLatencyMs = 0;

  for (const post of posts) {
    const cleanedContent = cleanPostContent(post.content);
    const expected = labelsByPostId[post.id] || [];

    let result;
    try {
      // Hybrid extraction: LLM + algorithmic search with LLM validation
      const modelConfig = { model: config.model, reasoning: config.reasoning };
      const hybridResult = await hybridExtract(post.title, cleanedContent, items, modelConfig);

      const validatedNames = hybridResult.items.map((v) => v.itemName || v.name);

      const metrics = evaluateExtraction(validatedNames, expected);

      result = {
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
        promptTokens: hybridResult.usage.promptTokens,
        completionTokens: hybridResult.usage.completionTokens,
        reasoningTokens: hybridResult.usage.reasoningTokens,
        latencyMs: hybridResult.latencyMs,
      };

      totalTp += metrics.tp;
      totalFp += metrics.fp;
      totalFn += metrics.fn;
      totalPromptTokens += hybridResult.usage.promptTokens;
      totalCompletionTokens += hybridResult.usage.completionTokens;
      totalReasoningTokens += hybridResult.usage.reasoningTokens;
      totalLatencyMs += hybridResult.latencyMs;
    } catch (err) {
      result = {
        runId: run.id,
        postId: post.id,
        postTitle: post.title,
        postHash: post.hash,
        tp: 0,
        fp: 0,
        fn: expected.length,
        latencyMs: 0,
        error: err.message,
      };
      totalFn += expected.length;
    }

    await prisma.benchmarkPostResult.create({ data: result });
  }

  // Calculate aggregate metrics
  const precision = totalTp + totalFp > 0 ? totalTp / (totalTp + totalFp) : 0;
  const recall = totalTp + totalFn > 0 ? totalTp / (totalTp + totalFn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

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

  for (const [key, group] of Object.entries(groups)) {
    const f1Values = group.runs.filter((r) => r.f1 !== null).map((r) => r.f1);
    const precisionValues = group.runs.filter((r) => r.precision !== null).map((r) => r.precision);
    const recallValues = group.runs.filter((r) => r.recall !== null).map((r) => r.recall);
    const latencyValues = group.runs.map((r) => r.totalLatencyMs);

    const f1Stats = computeStats(f1Values);
    const precisionStats = computeStats(precisionValues);
    const recallStats = computeStats(recallValues);
    const latencyStats = computeStats(latencyValues);

    console.log(`\n${group.configKey} (algorithm: ${group.algorithmHash})`);
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
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let numRuns = 10;
  let configFilter = null;
  let showStatsMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--runs' && args[i + 1]) {
      numRuns = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--config' && args[i + 1]) {
      configFilter = args[i + 1];
      i++;
    } else if (args[i] === '--stats') {
      showStatsMode = true;
    }
  }

  if (showStatsMode) {
    await showStatistics(configFilter);
    await prisma.$disconnect();
    return;
  }

  // Run benchmarks
  console.log('Loading fixtures...');
  const { posts, items, labelsByPostId } = await loadFixtures();
  console.log(`Loaded ${posts.length} posts, ${items.length} items`);

  const algorithm = await getOrCreateAlgorithm();

  const configsToRun = configFilter ? { [configFilter]: MODEL_CONFIGS[configFilter] } : MODEL_CONFIGS;

  if (configFilter && !MODEL_CONFIGS[configFilter]) {
    console.error(`Unknown config: ${configFilter}`);
    console.log('Available configs:', Object.keys(MODEL_CONFIGS).join(', '));
    await prisma.$disconnect();
    return;
  }

  console.log(`\nRunning ${numRuns} runs for each config: ${Object.keys(configsToRun).join(', ')}`);
  console.log(`Posts: ${BENCHMARK_POST_IDS.join(', ')}`);
  console.log(`Mode: Hybrid (LLM + Algorithmic with LLM validation)`);
  console.log('');

  for (const [configKey, config] of Object.entries(configsToRun)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`CONFIG: ${configKey}`);
    console.log('='.repeat(60));

    const runResults = [];

    for (let run = 1; run <= numRuns; run++) {
      process.stdout.write(`  Run ${run}/${numRuns}... `);
      try {
        const result = await runSingleBenchmark(algorithm, configKey, config, run, posts, items, labelsByPostId);
        runResults.push(result);
        console.log(`F1: ${(result.f1 * 100).toFixed(1)}%, Latency: ${(result.totalLatencyMs / 1000).toFixed(1)}s`);
      } catch (err) {
        console.log(`ERROR: ${err.message}`);
      }
    }

    // Summary for this config
    if (runResults.length > 0) {
      const f1Values = runResults.map((r) => r.f1);
      const stats = computeStats(f1Values);
      console.log(`\n  Summary: Mean F1: ${(stats.mean * 100).toFixed(1)}%, Median: ${(stats.median * 100).toFixed(1)}%, StdDev: ${(stats.stdDev * 100).toFixed(2)}%`);
    }
  }

  console.log('\n\nBenchmark complete. Run with --stats to see full statistics.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
