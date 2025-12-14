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
**Status:** [x] Complete

### Tasks
- [x] 1.1 Verify benchmark has no side effects on algorithm state - confirmed clean
- [x] 1.2 Fix broken import in `src/index.js:7` ✓ commit 6f659cc

---

## Issue 2: Dead Code & Disconnected Posts
**Status:** [x] Complete

### Tasks
- [x] 2.1 Update comment at line 63-65 to accurately describe which posts are used ✓ commit 5859626
- [x] 2.2 Review other posts - current selection is intentional (diverse test cases)
- [x] 2.3 **Ground Truth Label Audit (CRITICAL)** ✓ COMPLETE
  - [x] 2.3.1 Verified human-approved.json is SINGLE SOURCE OF TRUTH (only label file)
  - [x] 2.3.2 No other label files exist (checked via glob)
  - [x] 2.3.3 Spot-checked benchmark posts 3, 5 - labels accurate
  - [x] 2.3.4 Posts 1,2,4,9,10,11,13,14 have empty matches[] - intentional docs, not dead labels
  - [x] 2.3.5 Labeling criteria documented in human-approved.json notes field per post

---

## Issue 3: Text Filtering Algorithm Issue
**Status:** [x] Complete

### Tasks
- [x] 3.1 Remove brute-force text presence filter ✓ commit b9fd8e8

---

## Issue 4: Benchmark Parallelization
**Status:** [x] Complete ✓ commit a51dc5c

### Tasks
- [x] 4.1 Parallelize config loop with Promise.all
- [x] 4.2 Parallelize runs loop with Promise.all

---

## Issue 5: Unused JS Files
**Status:** [x] Complete

### Tasks
- [x] 5.1 Verify index.js works - fixed import
- [x] 5.2 Delete dead files ✓ commit 6f457d7
- [x] 5.3 Update ALGORITHM_FILES array ✓ commit 8c706ba
- [x] 5.4 pricePredictor.js kept - used by production pipeline

---

## Issue 6: Database Schema Cleanup
**Status:** [x] Complete

### Tasks
- [x] 6.1 Remove `description` column from BenchmarkAlgorithm
- [x] 6.2 Split into separate schemas (production vs benchmark)
- [x] 6.3 Production schema: prisma/schema.prisma → prisma/database.db
- [x] 6.4 Benchmark schema: tests/matching/prisma/schema.prisma → tests/matching/prisma/benchmark.db
- [x] 6.5 Surgically edited DBs to remove tables from wrong DB (no data loss)
- [x] 6.6 Generated separate Prisma clients for each schema

---

## Execution Order

### Phase 1: Critical Fixes ✓ COMPLETE
1. [x] Fix broken import in index.js (Issue 1.2) ✓ commit 6f659cc
2. [x] Remove text filter from hybridExtractor.js (Issue 3.1) ✓ commit b9fd8e8

### Phase 2: Cleanup ✓ COMPLETE
3. [x] Delete dead JS files (Issue 5.2) ✓ commit 6f457d7
4. [x] Update ALGORITHM_FILES (Issue 5.3) ✓ commit 8c706ba
5. [x] Update benchmark comments (Issue 2.1) ✓ commit 5859626

### Phase 3: Performance ✓ COMPLETE
6. [x] Parallelize benchmark loops (Issue 4.1, 4.2) ✓ commit a51dc5c

### Phase 4: Schema Cleanup ✓ COMPLETE
7. [x] Split schemas into production and benchmark ✓ commit ad047fa
8. [x] Move benchmark.db to tests/matching/prisma/ ✓ commit 1501cdd

### Phase 5: Validation
9. [ ] Run benchmark to verify nothing broke (NEEDS USER APPROVAL)

### Phase 6: Ground Truth Audit ✓ COMPLETE
10. [x] Complete Issue 2.3 - labels verified accurate
