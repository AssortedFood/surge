#!/usr/bin/env node
// tests/matching/benchmark-models.js
// Benchmarks item extraction across multiple OpenAI models
//
// Usage:
//   node benchmark-models.js                    # Run all models
//   node benchmark-models.js gpt-4.1-mini       # Run single model
//   node benchmark-models.js o4-mini:low        # Run with reasoning effort
//   node benchmark-models.js --compare          # Compare stored results
//
// Reasoning effort (for o4-mini, gpt-5-mini):
//   :minimal, :low, :medium, :high

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { cleanPostContent } from '../../src/contentCleaner.js';
import { validateItemCandidates } from '../../src/itemValidator.js';
import { ItemExtractionSchema } from '../../schemas/ItemExtractionSchema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');
const RESULTS_DIR = join(__dirname, 'benchmark-results');
const RESULTS_FILE = join(__dirname, 'benchmark-results.json'); // Legacy, for reading only

// Default model configurations
// Reasoning effort levels: low, medium, high, xhigh (for o4-mini, gpt-5-mini)
const MODEL_CONFIGS = {
  'gpt-4.1-mini': { model: 'gpt-4.1-mini', reasoning: null },
  'o4-mini:low': { model: 'o4-mini', reasoning: 'low' },
  'o4-mini:medium': { model: 'o4-mini', reasoning: 'medium' },
  'o4-mini:high': { model: 'o4-mini', reasoning: 'high' },
  'gpt-5-mini:low': { model: 'gpt-5-mini', reasoning: 'low' },
  'gpt-5-mini:medium': { model: 'gpt-5-mini', reasoning: 'medium' },
  'gpt-5-mini:high': { model: 'gpt-5-mini', reasoning: 'high' },
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Extraction prompt
const systemPrompt = `You are an Old School RuneScape expert. Extract ALL tradeable items mentioned or implied in this news post. Be thorough and comprehensive.

Rules:
- Only include items that can be traded on the Grand Exchange
- Do NOT include: quest items, untradeable rewards, currencies (coins/gp), NPCs, locations, skills
- IMPORTANT: When an item category is mentioned, include ALL tradeable variants:
  - "nails" → Bronze nails, Iron nails, Steel nails, Black nails, Mithril nails, Adamantite nails, Rune nails
  - "pickaxe" → Bronze pickaxe, Iron pickaxe, Steel pickaxe, Black pickaxe, Mithril pickaxe, Adamant pickaxe, Rune pickaxe, Dragon pickaxe, Infernal pickaxe, Crystal pickaxe
  - "impling jar" → Baby impling jar, Young impling jar, Gourmet impling jar, Earth impling jar, Essence impling jar, Eclectic impling jar, Nature impling jar, Magpie impling jar, Ninja impling jar, Crystal impling jar, Dragon impling jar, Lucky impling jar
  - Armour sets → Include each piece AND the set box (e.g., Virtus mask, Virtus robe top, Virtus robe bottom, Virtus armour set)
  - Potions → Include all dose variants (e.g., Anti-venom(4), Anti-venom(3), Anti-venom(2), Anti-venom(1))
  - "chinchompa" → Chinchompa, Red chinchompa, Black chinchompa
  - "bones" → Include specific bone types mentioned in context
- Include the exact snippet where the item category is mentioned (max 200 chars)
- Classify WHY the item is mentioned

Common false positives to AVOID:
- "staff" when referring to Jagex employees
- JMod names that match items (Pumpkin, Acorn, Ash, Grace, etc.)
- Generic words in non-item context (e.g., "shield your account", "gold sellers")
- Untradeable items: quest capes, skill capes, void equipment, graceful outfit pieces
- RS3-only items (this is OSRS)

Context classifications:
- buff: Item is being made stronger or more useful
- nerf: Item is being made weaker or less useful
- supply_change: Drop rate, source, or availability is changing
- new_content: Item is part of new content being added
- bug_fix: A bug related to the item is being fixed
- mention_only: Item is mentioned but no gameplay change`;

// Representative posts for benchmarking (posts with meaningful item matches)
// Post 3: Poll 85 (39 items), Post 5: Interface Uplift (17 items),
// Post 7: Sailing (18 items), Post 12: New Player (8 items)
const BENCHMARK_POST_IDS = [3, 5, 7, 12];

// Load fixtures
function loadFixtures() {
  let posts = JSON.parse(readFileSync(join(FIXTURES_DIR, 'posts.json'), 'utf-8'));
  const items = JSON.parse(readFileSync(join(FIXTURES_DIR, 'items.json'), 'utf-8'));
  const labels = JSON.parse(readFileSync(join(FIXTURES_DIR, 'labels', 'human-approved.json'), 'utf-8'));

  // Filter to representative posts only
  posts = posts.filter(p => BENCHMARK_POST_IDS.includes(p.id));

  return { posts, items, labels };
}

// Load stored results from individual files (avoids race conditions)
function loadResults() {
  const results = { runs: {} };

  // Create results dir if it doesn't exist
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Load from individual model files
  const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(RESULTS_DIR, file), 'utf-8'));
      if (data.configKey) {
        results.runs[data.configKey] = data;
      }
    } catch (e) {
      // Skip invalid files
    }
  }

  // Also load from legacy file if exists (for backwards compat)
  if (existsSync(RESULTS_FILE)) {
    try {
      const legacy = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
      // Only use legacy data for configs not in individual files
      for (const [key, value] of Object.entries(legacy.runs || {})) {
        if (!results.runs[key]) {
          results.runs[key] = value;
        }
      }
    } catch (e) {
      // Ignore legacy file errors
    }
  }

  return results;
}

// Save single model result to individual file (race-condition safe)
function saveResult(configKey, result) {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }
  const filename = configKey.replace(/:/g, '-') + '.json';
  writeFileSync(join(RESULTS_DIR, filename), JSON.stringify(result, null, 2));
}

// Extract items using a specific model config
async function extractWithModel(config, postTitle, cleanedContent) {
  const userMessage = `Post Title: "${postTitle}"

Content:
"""
${cleanedContent}
"""

Extract all tradeable OSRS items mentioned in this post.`;

  const startTime = Date.now();

  const requestParams = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    response_format: zodResponseFormat(ItemExtractionSchema, 'response'),
  };

  // Add reasoning effort for reasoning models
  if (config.reasoning) {
    requestParams.reasoning_effort = config.reasoning;
  }

  const response = await openai.chat.completions.create(requestParams);
  const latency = Date.now() - startTime;

  // Parse response
  const message = response.choices?.[0]?.message;
  let result;
  if (message?.parsed) {
    result = message.parsed;
  } else if (message?.content) {
    result = JSON.parse(message.content);
  } else {
    result = { items: [] };
  }

  return {
    items: result.items || [],
    latency,
    promptTokens: response.usage?.prompt_tokens || 0,
    completionTokens: response.usage?.completion_tokens || 0,
    reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens || 0,
  };
}

// Evaluate extraction results against labels
function evaluateResults(algoMatches, labeledPost) {
  const algoMatchNames = new Set(algoMatches.map(m => m.itemName.toLowerCase()));
  const expectedNames = new Set(
    (labeledPost?.matches || []).map(m => m.itemName.toLowerCase())
  );

  let tp = 0, fp = 0, fn = 0;

  for (const name of algoMatchNames) {
    if (expectedNames.has(name)) tp++;
    else fp++;
  }
  for (const name of expectedNames) {
    if (!algoMatchNames.has(name)) fn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  return { tp, fp, fn, precision, recall, f1 };
}

// Format percentage
function pct(n) {
  return (n * 100).toFixed(1) + '%';
}

// Run benchmark for a single model config
async function benchmarkModel(configKey, config, posts, items, labelsByPostId) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`BENCHMARKING: ${configKey}`);
  if (config.reasoning) {
    console.log(`Reasoning effort: ${config.reasoning}`);
  }
  console.log('='.repeat(60));

  const startTime = Date.now();
  const postResults = [];
  let totalLatency = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalReasoningTokens = 0;

  for (const post of posts) {
    process.stdout.write(`  Post ${post.id}... `);

    try {
      const cleanedContent = cleanPostContent(post.content);
      const extraction = await extractWithModel(config, post.title, cleanedContent);
      const validated = validateItemCandidates(extraction.items, items);
      const labeledPost = labelsByPostId.get(post.id);
      const metrics = evaluateResults(validated, labeledPost);

      postResults.push({
        postId: post.id,
        ...metrics,
        latency: extraction.latency,
        promptTokens: extraction.promptTokens,
        completionTokens: extraction.completionTokens,
        reasoningTokens: extraction.reasoningTokens,
      });

      totalLatency += extraction.latency;
      totalPromptTokens += extraction.promptTokens;
      totalCompletionTokens += extraction.completionTokens;
      totalReasoningTokens += extraction.reasoningTokens;

      console.log(`${extraction.items.length} items, ${extraction.latency}ms, ${metrics.tp}TP/${metrics.fp}FP/${metrics.fn}FN`);

      // Rate limit delay
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      postResults.push({
        postId: post.id,
        tp: 0, fp: 0, fn: labelsByPostId.get(post.id)?.matches?.length || 0,
        precision: 0, recall: 0, f1: 0,
        latency: 0,
        promptTokens: 0, completionTokens: 0, reasoningTokens: 0,
        error: err.message,
      });
    }
  }

  // Calculate aggregates
  let totalTp = 0, totalFp = 0, totalFn = 0;
  for (const r of postResults) {
    totalTp += r.tp;
    totalFp += r.fp;
    totalFn += r.fn;
  }

  const precision = totalTp + totalFp > 0 ? totalTp / (totalTp + totalFp) : 0;
  const recall = totalTp + totalFn > 0 ? totalTp / (totalTp + totalFn) : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

  const elapsedTime = Date.now() - startTime;

  return {
    configKey,
    model: config.model,
    reasoningEffort: config.reasoning,
    timestamp: new Date().toISOString(),
    precision,
    recall,
    f1,
    totalTp,
    totalFp,
    totalFn,
    avgLatency: Math.round(totalLatency / posts.length),
    totalTokens: totalPromptTokens + totalCompletionTokens,
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    reasoningTokens: totalReasoningTokens,
    avgTokensPerPost: Math.round((totalPromptTokens + totalCompletionTokens) / posts.length),
    elapsedTime,
    postResults,
  };
}

// Format latency as human readable
function formatLatency(ms) {
  if (ms < 1000) return `${ms}ms`;
  const secs = (ms / 1000).toFixed(1);
  return `${secs}s`;
}

// Compare results
function compareResults(results) {
  console.log('\n' + '='.repeat(115));
  console.log('MODEL COMPARISON (stored results)');
  console.log('='.repeat(115));
  console.log('');
  console.log('| Config                | Precision | Recall  | F1      | Latency  | Tokens/Post | Reasoning Tokens |');
  console.log('|-----------------------|-----------|---------|---------|----------|-------------|------------------|');

  // Sort by F1 descending
  const sortedByF1 = Object.keys(results.runs).sort((a, b) => {
    return results.runs[b].f1 - results.runs[a].f1;
  });

  for (const key of sortedByF1) {
    const r = results.runs[key];
    const latency = formatLatency(r.avgLatency).padStart(8);
    console.log(`| ${key.padEnd(21)} | ${pct(r.precision).padStart(9)} | ${pct(r.recall).padStart(7)} | ${pct(r.f1).padStart(7)} | ${latency} | ${String(r.avgTokensPerPost).padStart(11)} | ${String(r.reasoningTokens).padStart(16)} |`);
  }
  console.log('');

  // Sort by latency ascending (fastest first)
  const sortedBySpeed = Object.keys(results.runs).sort((a, b) => {
    return results.runs[a].avgLatency - results.runs[b].avgLatency;
  });

  // Find key metrics
  const fastest = results.runs[sortedBySpeed[0]];
  const fastestKey = sortedBySpeed[0];
  const bestF1 = results.runs[sortedByF1[0]];
  const bestF1Key = sortedByF1[0];

  // Find optimal: best F1 among models under 60s latency, or fastest model with F1 > 70%
  const LATENCY_THRESHOLD = 60000; // 60 seconds
  const F1_THRESHOLD = 0.70; // 70% minimum F1

  const fastEnough = Object.entries(results.runs)
    .filter(([_, r]) => r.avgLatency <= LATENCY_THRESHOLD)
    .sort((a, b) => b[1].f1 - a[1].f1);

  const goodEnough = Object.entries(results.runs)
    .filter(([_, r]) => r.f1 >= F1_THRESHOLD)
    .sort((a, b) => a[1].avgLatency - b[1].avgLatency);

  // Prefer fast+accurate, fallback to fastest good-enough model
  const optimal = fastEnough.length > 0 && fastEnough[0][1].f1 >= F1_THRESHOLD
    ? { key: fastEnough[0][0], ...fastEnough[0][1] }
    : goodEnough.length > 0
      ? { key: goodEnough[0][0], ...goodEnough[0][1] }
      : { key: fastestKey, ...fastest };

  console.log('RECOMMENDATIONS');
  console.log('-'.repeat(70));
  console.log('');
  console.log(`  FASTEST:     ${fastestKey}`);
  console.log(`               ${formatLatency(fastest.avgLatency)} latency, ${pct(fastest.f1)} F1`);
  console.log('');
  console.log(`  BEST F1:     ${bestF1Key}`);
  console.log(`               ${pct(bestF1.f1)} F1, ${formatLatency(bestF1.avgLatency)} latency`);
  console.log('');
  console.log(`  OPTIMAL:     ${optimal.key}`);
  console.log(`               Best F1/latency tradeoff: ${pct(optimal.f1)} F1 in ${formatLatency(optimal.avgLatency)}`);
  console.log('');

  // Speed-sorted table for quick reference
  console.log('BY SPEED (fastest first)');
  console.log('-'.repeat(70));
  for (const key of sortedBySpeed) {
    const r = results.runs[key];
    console.log(`  ${formatLatency(r.avgLatency).padEnd(8)} | ${pct(r.f1).padEnd(7)} F1 | ${key}`);
  }

  console.log('');
  console.log('='.repeat(115));
}

// Main
async function main() {
  const args = process.argv.slice(2);

  // Compare mode
  if (args.includes('--compare')) {
    const results = loadResults();
    if (Object.keys(results.runs).length === 0) {
      console.log('No stored results found. Run benchmarks first.');
      return;
    }
    compareResults(results);
    return;
  }

  // Load fixtures
  console.log('Loading fixtures...');
  const { posts, items, labels } = loadFixtures();
  const labelsByPostId = new Map(labels.posts.map(p => [p.postId, p]));
  console.log(`Loaded ${posts.length} posts, ${items.length} items`);

  // Determine which models to run
  let modelsToRun = [];
  if (args.length === 0) {
    // Run all default configs
    modelsToRun = Object.keys(MODEL_CONFIGS);
    console.log('Running all model configurations...');
  } else {
    // Run specific models from args
    for (const arg of args) {
      if (arg.startsWith('--')) continue;
      if (MODEL_CONFIGS[arg]) {
        modelsToRun.push(arg);
      } else {
        // Maybe it's just a model name without effort level
        const matching = Object.keys(MODEL_CONFIGS).filter(k => k.startsWith(arg));
        if (matching.length > 0) {
          modelsToRun.push(...matching);
        } else {
          console.warn(`Unknown model config: ${arg}`);
        }
      }
    }
  }

  if (modelsToRun.length === 0) {
    console.log('No models to run. Available configs:');
    for (const key of Object.keys(MODEL_CONFIGS)) {
      console.log(`  ${key}`);
    }
    return;
  }

  console.log(`Models to run: ${modelsToRun.join(', ')}`);

  // Load existing results
  const allResults = loadResults();

  // Run benchmarks
  for (const configKey of modelsToRun) {
    const config = MODEL_CONFIGS[configKey];
    try {
      const result = await benchmarkModel(configKey, config, posts, items, labelsByPostId);
      allResults.runs[configKey] = result;
      saveResult(configKey, result); // Save to individual file (race-condition safe)
      console.log(`\nResult saved for ${configKey}: F1=${pct(result.f1)}`);
    } catch (err) {
      console.error(`\nFailed to benchmark ${configKey}: ${err.message}`);
    }
  }

  // Show comparison
  compareResults(allResults);
}

main().catch(console.error);
