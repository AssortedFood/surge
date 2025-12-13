#!/usr/bin/env node
// tests/matching/evaluate.js
// Evaluates the item matching algorithm against human-labeled ground truth

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { findMatches } from '../../src/itemMatcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

// Load fixtures
function loadFixtures() {
  const posts = JSON.parse(readFileSync(join(FIXTURES_DIR, 'posts.json'), 'utf-8'));
  const items = JSON.parse(readFileSync(join(FIXTURES_DIR, 'items.json'), 'utf-8'));
  const labels = JSON.parse(readFileSync(join(FIXTURES_DIR, 'labels', 'human-approved.json'), 'utf-8'));
  return { posts, items, labels };
}

// Calculate metrics for a single post
function evaluatePost(post, items, labeledPost) {
  // Run the algorithm
  const algoMatches = findMatches(post.content, items);
  const algoMatchNames = new Set(algoMatches.map(m => m.name.toLowerCase()));

  // Get ground truth
  const expectedNames = new Set(
    (labeledPost?.matches || []).map(m => m.itemName.toLowerCase())
  );

  // Calculate true positives, false positives, false negatives
  const truePositives = new Set();
  const falsePositives = new Set();
  const falseNegatives = new Set();

  for (const name of algoMatchNames) {
    if (expectedNames.has(name)) {
      truePositives.add(name);
    } else {
      falsePositives.add(name);
    }
  }

  for (const name of expectedNames) {
    if (!algoMatchNames.has(name)) {
      falseNegatives.add(name);
    }
  }

  const tp = truePositives.size;
  const fp = falsePositives.size;
  const fn = falseNegatives.size;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  return {
    postId: post.id,
    postTitle: post.title,
    metrics: { tp, fp, fn, precision, recall, f1 },
    truePositives: [...truePositives],
    falsePositives: [...falsePositives],
    falseNegatives: [...falseNegatives],
    algoMatchCount: algoMatches.length,
    expectedMatchCount: expectedNames.size,
  };
}

// Calculate aggregate metrics
function calculateAggregateMetrics(results) {
  let totalTp = 0, totalFp = 0, totalFn = 0;

  for (const r of results) {
    totalTp += r.metrics.tp;
    totalFp += r.metrics.fp;
    totalFn += r.metrics.fn;
  }

  const precision = totalTp + totalFp > 0 ? totalTp / (totalTp + totalFp) : 0;
  const recall = totalTp + totalFn > 0 ? totalTp / (totalTp + totalFn) : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  return { totalTp, totalFp, totalFn, precision, recall, f1 };
}

// Format percentage
function pct(n) {
  return (n * 100).toFixed(1) + '%';
}

// Main evaluation
function main() {
  console.log('Loading fixtures...');
  const { posts, items, labels } = loadFixtures();

  console.log(`Loaded ${posts.length} posts, ${items.length} items, ${labels.posts.length} labeled posts\n`);

  // Create lookup for labels by postId
  const labelsByPostId = new Map(labels.posts.map(p => [p.postId, p]));

  // Evaluate each post
  const results = [];
  for (const post of posts) {
    const labeledPost = labelsByPostId.get(post.id);
    const result = evaluatePost(post, items, labeledPost);
    results.push(result);
  }

  // Print per-post results
  console.log('=' .repeat(80));
  console.log('PER-POST RESULTS');
  console.log('=' .repeat(80));

  for (const r of results) {
    const { metrics } = r;
    console.log(`\n[Post ${r.postId}] ${r.postTitle}`);
    console.log(`  Expected: ${r.expectedMatchCount} | Algo found: ${r.algoMatchCount}`);
    console.log(`  TP: ${metrics.tp} | FP: ${metrics.fp} | FN: ${metrics.fn}`);
    console.log(`  Precision: ${pct(metrics.precision)} | Recall: ${pct(metrics.recall)} | F1: ${pct(metrics.f1)}`);

    if (r.falsePositives.length > 0) {
      console.log(`  False Positives (algo found, not in labels):`);
      for (const fp of r.falsePositives.slice(0, 10)) {
        console.log(`    - ${fp}`);
      }
      if (r.falsePositives.length > 10) {
        console.log(`    ... and ${r.falsePositives.length - 10} more`);
      }
    }

    if (r.falseNegatives.length > 0) {
      console.log(`  False Negatives (in labels, algo missed):`);
      for (const fn of r.falseNegatives.slice(0, 10)) {
        console.log(`    - ${fn}`);
      }
      if (r.falseNegatives.length > 10) {
        console.log(`    ... and ${r.falseNegatives.length - 10} more`);
      }
    }
  }

  // Print aggregate results
  const agg = calculateAggregateMetrics(results);

  console.log('\n' + '=' .repeat(80));
  console.log('AGGREGATE RESULTS');
  console.log('=' .repeat(80));
  console.log(`Total True Positives:  ${agg.totalTp}`);
  console.log(`Total False Positives: ${agg.totalFp}`);
  console.log(`Total False Negatives: ${agg.totalFn}`);
  console.log('');
  console.log(`Precision: ${pct(agg.precision)}`);
  console.log(`Recall:    ${pct(agg.recall)}`);
  console.log(`F1 Score:  ${pct(agg.f1)}`);
  console.log('=' .repeat(80));

  // Summary table
  console.log('\nSUMMARY TABLE');
  console.log('-'.repeat(80));
  console.log('Post ID | Title (truncated)                    | Prec   | Rec    | F1');
  console.log('-'.repeat(80));
  for (const r of results) {
    const title = r.postTitle.length > 35 ? r.postTitle.slice(0, 32) + '...' : r.postTitle.padEnd(35);
    console.log(`${String(r.postId).padStart(7)} | ${title} | ${pct(r.metrics.precision).padStart(6)} | ${pct(r.metrics.recall).padStart(6)} | ${pct(r.metrics.f1).padStart(6)}`);
  }
  console.log('-'.repeat(80));
}

main();
