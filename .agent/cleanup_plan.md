# Comprehensive Cleanup Plan

> **NOTE:** Do NOT run benchmarks without explicit approval from the human. Benchmarks are expensive (time + API costs) and should only be run when requested.

> **WORKFLOW:** For each task:
> 1. Make the change
> 2. Test it where possible (lint, type check, simple verification - NOT full benchmark)
> 3. Commit the change with a clear message
> 4. Return to this plan and tick off what was done
> 5. Pick the next item
> 6. Repeat

## Issue 1: Benchmark Isolation
**Status:** [ ] Not Started

### Problem
Benchmark should ONLY: call algo → eval results → save to DB. No mutations, no side effects.

### Current State
- benchmark.js:322 calls `extractItems()` ✓
- benchmark.js:326 evaluates results ✓
- benchmark.js:401-416 saves to DB ✓
- **ISSUE:** `src/index.js:7` imports `hybridExtractWithVoting` which DOES NOT EXIST in exports

### Tasks
- [ ] 1.1 Verify benchmark has no side effects on algorithm state
- [ ] 1.2 Fix broken import in `src/index.js:7` - `hybridExtractWithVoting` not exported
  - Export is: `hybridExtractInline, algorithmicSearch, MIN_ALGO_SEARCH_LENGTH`
  - Need to either export `hybridExtractWithVoting` or change import to `hybridExtractInline`

---

## Issue 2: Dead Code & Disconnected Posts
**Status:** [ ] Not Started

### Problem
Comments don't match code, files not connected, posts list confusion.

### Current State
```
BENCHMARK_POST_IDS = [3, 5, 6, 7, 8, 12, 15]

Fixture files exist:
01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15
```
- Posts 3, 5, 6, 7, 8, 12, 15 are used ✓
- Comment says "7 diverse posts" ✓ (matches array length)
- Comment says "Excludes posts with 0 items (Post 2)" - only excludes 2, but also excludes 1, 4, 9, 10, 11, 13, 14

### Tasks
- [ ] 2.1 Update comment at line 63-65 to accurately describe which posts are used and why
- [ ] 2.2 Review if other posts (1, 4, 9, 10, 11, 13, 14) should be added to benchmark
- [ ] 2.3 **Ground Truth Label Audit (CRITICAL)**
  - [ ] 2.3.1 Verify human-approved.json is the SINGLE SOURCE OF TRUTH for labels
  - [ ] 2.3.2 Ensure NO other label files exist anywhere in codebase
  - [ ] 2.3.3 For EACH benchmark post (3, 5, 6, 7, 8, 12, 15):
    - Read the actual post content
    - Compare against labels in human-approved.json
    - Verify every labeled item is genuinely mentioned/affected
    - Verify no items are missing from labels
  - [ ] 2.3.4 Remove any labels for posts NOT in BENCHMARK_POST_IDS (dead labels)
  - [ ] 2.3.5 Document labeling criteria (what counts as a "match")

---

## Issue 3: Text Filtering Algorithm Issue
**Status:** [ ] Not Started

### Problem
My recently added text presence filter (lines 534-557) kills set expansions.

### Current State
```javascript
// Lines 534-557 in hybridExtractor.js
const textPresent = llmValidated.filter((item) => {
  return contentLower.includes(itemNameLower) || ...;
});
```
- Kills hallucinations (FP → 0) ✓
- Also kills legitimate set expansions (TP drops, FN rises) ✗
- "Virtus" in text → expands to "Virtus mask" → filtered because "Virtus mask" not in text

### Tasks
- [ ] 3.1 Remove brute-force text presence filter (lines 534-557)
- [ ] 3.2 Alternative: Only accept items that came from `algoMatches` (items the algo search found)
- [ ] 3.3 Or: Constrain LLM to only output items from markers (schema change)

---

## Issue 4: Benchmark Parallelization
**Status:** [ ] Not Started

### Problem
Benchmarks run SEQUENTIALLY. Should be parallel.

### Current State
```javascript
// Lines 847-871 - SEQUENTIAL
for (const [configKey, config] of Object.entries(configsToRun)) {
  for (let run = 1; run <= numRuns; run++) {
    const result = await runSingleBenchmark(...);  // SEQUENTIAL AWAIT
  }
}
```
- 4 configs × 10 runs = 40 sequential calls
- Each call processes 7 posts (already parallel via Promise.all at line 315)
- Total time = sum of all 40 calls instead of max

### Tasks
- [ ] 4.1 Parallelize config loop with Promise.all
- [ ] 4.2 Parallelize runs loop with Promise.all
- [ ] 4.3 Result: `max(all calls)` instead of `sum(all calls)`

### Target Code
```javascript
const allResults = await Promise.all(
  Object.entries(configsToRun).flatMap(([configKey, config]) =>
    Array(numRuns).fill().map((_, i) =>
      runSingleBenchmark(algorithm, configKey, config, i + 1, posts, significantItems, labelsByPostId, groundTruthHash, verboseMode)
    )
  )
);
```

---

## Issue 5: Unused JS Files
**Status:** [ ] Not Started

### Problem
Many JS files not connected to anything.

### Analysis
| File | Status | Used By |
|------|--------|---------|
| `src/itemExtractor.js` | DEAD | Only in ALGORITHM_FILES array, evaluate-llm.js (not benchmark) |
| `src/semanticItemAnalysis.js` | DEAD | Only its own test |
| `src/semanticItemAnalysis.test.js` | TEST | - |
| `src/itemMatcher.js` | DEAD | Only its own test |
| `src/itemMatcher.test.js` | TEST | - |
| `src/genericWords.js` | DEAD | Only itemMatcher.js (which is dead) |
| `src/pricePredictor.js` | DEAD? | Only index.js (check if index.js even works) |
| `schemas/ItemAnalysisSchema.js` | DEAD | Only semanticItemAnalysis.js (dead) |
| `schemas/PricePredictionSchema.js` | DEAD? | Only pricePredictor.js |

### Tasks
- [ ] 5.1 Verify index.js actually works (broken import at line 7)
- [ ] 5.2 Delete dead files or move to archive:
  - `src/itemExtractor.js`
  - `src/semanticItemAnalysis.js`
  - `src/semanticItemAnalysis.test.js`
  - `src/itemMatcher.js`
  - `src/itemMatcher.test.js`
  - `src/genericWords.js`
  - `schemas/ItemAnalysisSchema.js`
- [ ] 5.3 Update ALGORITHM_FILES array to remove deleted files
- [ ] 5.4 Decide: keep or delete pricePredictor.js and PricePredictionSchema.js

---

## Issue 6: Unused Database Tables/Columns
**Status:** [ ] Not Started

### Problem
Schema has unused tables and columns.

### Analysis
| Table/Column | Status | Notes |
|--------------|--------|-------|
| `BenchmarkAlgorithm.description` | UNUSED | Never set, never read |
| `Item` | PARTIAL | Used by itemFilter.js, but benchmark uses SignificantItem |
| `ItemAnalysis` | UNUSED | Only referenced by dead semanticItemAnalysis.js |
| `Post` | PARTIAL | Used by syncPosts.js, but benchmark uses fixture files |
| `PriceSnapshot` | UNUSED | No code references except schema relations |

### Tasks
- [ ] 6.1 Remove `description` column from BenchmarkAlgorithm (migration)
- [ ] 6.2 Decide: Keep Item/Post/PriceSnapshot for production use, or delete if benchmarking only
- [ ] 6.3 Delete ItemAnalysis table if semanticItemAnalysis.js is deleted
- [ ] 6.4 Run prisma migrate to clean schema

---

## Execution Order

### Phase 1: Critical Fixes
1. [x] Fix broken import in index.js (Issue 1.2) ✓ commit 6f659cc
2. [x] Remove text filter from hybridExtractor.js (Issue 3.1) ✓ commit b9fd8e8

### Phase 2: Cleanup
3. [ ] Delete dead JS files (Issue 5.2)
4. [ ] Update ALGORITHM_FILES (Issue 5.3)
5. [ ] Update benchmark comments (Issue 2.1)

### Phase 3: Performance
6. [ ] Parallelize benchmark loops (Issue 4.1, 4.2)

### Phase 4: Schema Cleanup
7. [ ] Remove unused DB columns/tables (Issue 6)
8. [ ] Run prisma migrate

### Phase 5: Validation
9. [ ] Run benchmark to verify nothing broke
10. [ ] Commit with clear message
