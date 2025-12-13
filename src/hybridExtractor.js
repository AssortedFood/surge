// src/hybridExtractor.js
// Hybrid item extraction: combines LLM extraction with algorithmic search
// for improved precision (catch hallucinations) and recall (catch misses)

import { extractItemCandidates } from './itemExtractor.js';
import { validateItemCandidates } from './itemValidator.js';
import logger from './utils/logger.js';

// Minimum character length for algorithmic search (avoid short false positives)
const MIN_ALGO_SEARCH_LENGTH = 4;

// Stricter threshold for adding algo-only items (must be very confident)
const MIN_ALGO_ONLY_LENGTH = 6;

// Ambiguous item names to skip in algorithmic search
// These are common words or JMod names that would cause false positives
const ALGO_BLOCKLIST = new Set([
  'ash',
  'logs',
  'log',
  'gold',
  'coal',
  'fish',
  'cape',
  'hat',
  'ring',
  'staff', // Often refers to Jagex staff
  'seed',
  'seeds',
  'coin',
  'coins',
  'bronze',
  'iron',
  'steel',
  'black',
  'white',
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'grey',
  'gray',
  'grace', // JMod name
  'acorn', // JMod name
  'pumpkin', // JMod name
  'mod',
  'team',
  'food',
  'item',
  'items',
  'game',
  'quest',
  'skill',
  'attack',
  'defence',
  'defense',
  'strength',
  'magic',
  'prayer',
  'range',
  'ranged',
]);

/**
 * Escapes special regex characters in a string
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Performs lenient algorithmic search for item names in post content
 * Uses word boundary matching to avoid partial matches
 *
 * @param {string} content - The post content to search
 * @param {Array<{id: number, name: string}>} allItems - All items from database
 * @returns {Map<number, {item: object, matchType: string}>} - Map of itemId to match info
 */
function algorithmicSearch(content, allItems) {
  const found = new Map();
  const contentLower = content.toLowerCase();

  for (const item of allItems) {
    const nameLower = item.name.toLowerCase();

    // Skip items that are too short or blocklisted
    if (nameLower.length < MIN_ALGO_SEARCH_LENGTH) continue;
    if (ALGO_BLOCKLIST.has(nameLower)) continue;

    // Also check base name without parenthetical suffix for blocklist
    const baseName = nameLower.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (ALGO_BLOCKLIST.has(baseName)) continue;

    // Try exact substring match first (fast path)
    if (!contentLower.includes(nameLower)) continue;

    // Verify with word boundary regex (slower but accurate)
    // This prevents "gold" matching inside "marigold"
    try {
      const pattern = new RegExp(`\\b${escapeRegex(nameLower)}\\b`, 'i');
      if (pattern.test(content)) {
        found.set(item.id, {
          item,
          matchType: 'exact',
        });
      }
    } catch {
      // If regex fails (shouldn't happen), skip this item
      continue;
    }
  }

  return found;
}

/**
 * Hybrid extraction: runs LLM and algorithmic search in parallel,
 * then combines results with confidence scoring
 *
 * @param {string} postTitle - The post title
 * @param {string} cleanedContent - The cleaned post content
 * @param {Array<{id: number, name: string}>} allItems - All items from database
 * @returns {Promise<{items: Array, stats: object}>}
 */
async function hybridExtract(postTitle, cleanedContent, allItems) {
  const startTime = Date.now();

  // Run LLM extraction and algorithmic search in parallel
  const [llmCandidates, algoMatches] = await Promise.all([
    extractItemCandidates(postTitle, cleanedContent),
    Promise.resolve(algorithmicSearch(cleanedContent, allItems)),
  ]);

  const algoTime = Date.now() - startTime;

  // Validate LLM candidates against database
  const llmValidated = validateItemCandidates(llmCandidates, allItems);

  // Build set of LLM-found item IDs for comparison
  const llmItemIds = new Set(llmValidated.map((v) => v.itemId));

  // Categorize results
  const confirmed = []; // LLM + Algo
  const llmOnly = []; // LLM only (trust LLM context awareness)
  const algoOnly = []; // Algo only (potential misses)

  // Process LLM results
  for (const item of llmValidated) {
    if (algoMatches.has(item.itemId)) {
      confirmed.push({ ...item, confidence: 1.0, source: 'both' });
    } else {
      llmOnly.push({ ...item, confidence: 0.8, source: 'llm' });
    }
  }

  // Process algo-only results (items LLM missed)
  for (const [itemId, matchInfo] of algoMatches) {
    if (!llmItemIds.has(itemId)) {
      const { item } = matchInfo;

      // Only add algo-only items if they meet strict criteria
      // Must be longer name (6+ chars) to reduce false positives
      if (item.name.length >= MIN_ALGO_ONLY_LENGTH) {
        algoOnly.push({
          name: item.name,
          snippet: '[Algorithmically detected - not found by LLM]',
          context: 'mention_only',
          itemId: item.id,
          itemName: item.name,
          confidence: 0.3,
          source: 'algo',
        });
      }
    }
  }

  // Combine all results, sorted by confidence
  const allResults = [...confirmed, ...llmOnly, ...algoOnly].sort(
    (a, b) => b.confidence - a.confidence
  );

  const stats = {
    llmCandidates: llmCandidates.length,
    llmValidated: llmValidated.length,
    algoMatches: algoMatches.size,
    confirmed: confirmed.length,
    llmOnly: llmOnly.length,
    algoOnly: algoOnly.length,
    total: allResults.length,
    algoTimeMs: algoTime,
  };

  logger.debug('Hybrid extraction complete', {
    postTitle,
    ...stats,
  });

  return { items: allResults, stats };
}

/**
 * Validates hybrid extraction results, returning only high-confidence items
 * Use this for production to filter out low-confidence algo-only matches
 *
 * @param {Array} hybridResults - Results from hybridExtract
 * @param {number} minConfidence - Minimum confidence threshold (default 0.5)
 * @returns {Array}
 */
function filterByConfidence(hybridResults, minConfidence = 0.5) {
  return hybridResults.filter((item) => item.confidence >= minConfidence);
}

export {
  hybridExtract,
  algorithmicSearch,
  filterByConfidence,
  MIN_ALGO_SEARCH_LENGTH,
  MIN_ALGO_ONLY_LENGTH,
};
