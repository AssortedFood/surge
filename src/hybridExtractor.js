// src/hybridExtractor.js
// Hybrid item extraction: combines LLM extraction with algorithmic search
// for improved precision (catch hallucinations) and recall (catch misses)

import 'dotenv/config';
import { extractItemCandidates } from './itemExtractor.js';
import { validateItemCandidates } from './itemValidator.js';
import { fetchStructuredResponse } from './fetchStructuredResponse.js';
import logger from './utils/logger.js';
import { z } from 'zod';

// Default model config from env vars (used when no config passed)
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'o4-mini';
const DEFAULT_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || 'low';

// Confidence scores for different extraction sources
// These can be tuned based on benchmark results
const CONFIDENCE_SCORES = {
  confirmed: 1.0, // Both LLM and algo found the item
  llmOnly: 0.8, // LLM found but algo didn't (context-aware)
  algoValidated: 0.7, // Algo found and LLM confirmed relevance
};

// Schema for validating algo-found candidates
const AlgoValidationSchema = z.object({
  validItems: z
    .array(
      z.object({
        name: z.string().describe('The item name exactly as provided'),
        isRelevant: z
          .boolean()
          .describe(
            'Whether this item is actually mentioned as a tradeable item in context'
          ),
        snippet: z
          .string()
          .describe(
            'The text snippet where this item appears, or empty if not relevant'
          ),
      })
    )
    .describe('Validation results for each candidate item'),
});

// Minimum character length for algorithmic search (avoid short false positives)
const MIN_ALGO_SEARCH_LENGTH = 4;

// Ambiguous item names to skip in algorithmic search
// These are common words or JMod names that would cause false positives
const ALGO_BLOCKLIST = new Set([
  // JMod names that match items
  'ash',
  'grace',
  'acorn',
  'pumpkin',
  'mod',

  // Generic resource words (too ambiguous without context)
  'logs',
  'log',
  'gold',
  'coal',
  'fish',
  'seed',
  'seeds',
  'coin',
  'coins',
  'ore',
  'bar',
  'rune',
  'runes',

  // Equipment words (too generic)
  'cape',
  'hat',
  'ring',
  'staff',
  'sword',
  'shield',
  'helm',
  'boots',
  'gloves',
  'body',
  'legs',
  'plate',
  'chain',

  // Material/tier names
  'bronze',
  'iron',
  'steel',
  'black',
  'white',
  'mithril',
  'adamant',
  'rune',
  'dragon',

  // Colors
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'grey',
  'gray',

  // Skill names
  'attack',
  'defence',
  'defense',
  'strength',
  'magic',
  'prayer',
  'range',
  'ranged',
  'hitpoints',
  'mining',
  'smithing',
  'fishing',
  'cooking',
  'woodcutting',
  'firemaking',
  'crafting',
  'fletching',
  'herblore',
  'agility',
  'thieving',
  'slayer',
  'farming',
  'runecraft',
  'hunter',
  'construction',

  // Common game/post words
  'team',
  'food',
  'item',
  'items',
  'game',
  'quest',
  'skill',
  'drop',
  'rate',
  'chance',
  'update',
  'patch',
  'fix',
  'change',
  'buff',
  'nerf',
  'ban',
  'block',
  'trade',
  'split',
  'map',
  'light',
  'rock',
  'shade',
  'world',
  'level',
  'boss',
  'monster',
  'player',
  'account',
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
 * Validates algo-only candidates with a single LLM call
 * Asks the LLM to confirm which candidates are actually relevant items
 *
 * @param {string} postTitle - The post title
 * @param {string} content - The post content
 * @param {Array<{id: number, name: string}>} candidates - Algo-found items to validate
 * @param {object} modelConfig - Model configuration {model, reasoning}
 * @returns {Promise<{items: Array, usage: object}>}
 */
async function validateAlgoCandidates(
  postTitle,
  content,
  candidates,
  modelConfig = {}
) {
  const emptyResult = {
    items: [],
    usage: { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 },
  };

  if (candidates.length === 0) return emptyResult;

  const model = modelConfig.model || DEFAULT_MODEL;
  const reasoning = modelConfig.reasoning || DEFAULT_REASONING_EFFORT;

  const candidateNames = candidates.map((c) => c.name);

  const systemPrompt = `You are an Old School RuneScape expert. You will be given a list of potential item names found in a news post. Your job is to determine which ones are ACTUALLY being mentioned as tradeable items in the context of the post.

Rules:
- Only mark items as relevant if they are genuinely being discussed as tradeable OSRS items
- "Bones" appearing in "bare bones" or "backbone" is NOT relevant
- Item names that are JMod names (Ash, Acorn, etc.) are NOT relevant
- Items mentioned only as untradeable quest/skill rewards are NOT relevant
- Items that are part of the actual game content discussion ARE relevant`;

  const userMessage = `Post Title: "${postTitle}"

Content:
"""
${content}
"""

Candidate items to validate:
${candidateNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}

For each candidate, determine if it's actually mentioned as a tradeable item in this post.`;

  try {
    const response = await fetchStructuredResponse(
      model,
      systemPrompt,
      userMessage,
      AlgoValidationSchema,
      { reasoningEffort: reasoning }
    );

    const usage = {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      reasoningTokens:
        response.usage?.completion_tokens_details?.reasoning_tokens || 0,
    };

    const message = response.choices?.[0]?.message;
    let result;

    if (message?.parsed) {
      result = message.parsed;
    } else if (message?.content) {
      result = JSON.parse(message.content);
    } else {
      return { items: [], usage };
    }

    // Filter to only relevant items and map back to full item info
    const validatedItems = [];
    const candidateMap = new Map(
      candidates.map((c) => [c.name.toLowerCase(), c])
    );

    for (const item of result.validItems || []) {
      if (item.isRelevant) {
        const original = candidateMap.get(item.name.toLowerCase());
        if (original) {
          validatedItems.push({
            name: original.name,
            snippet: item.snippet || '[Validated by LLM]',
            context: 'mention_only',
            itemId: original.id,
            itemName: original.name,
          });
        }
      }
    }

    logger.debug('Validated algo candidates', {
      postTitle,
      candidates: candidates.length,
      validated: validatedItems.length,
    });

    return { items: validatedItems, usage };
  } catch (err) {
    logger.error('Algo candidate validation failed', {
      error: err.message,
      postTitle,
    });
    return emptyResult;
  }
}

/**
 * Hybrid extraction: runs LLM and algorithmic search in parallel,
 * then validates algo-only candidates with a second LLM call
 *
 * @param {string} postTitle - The post title
 * @param {string} cleanedContent - The cleaned post content
 * @param {Array<{id: number, name: string}>} allItems - All items from database
 * @param {object} modelConfig - Optional model configuration {model, reasoning}
 * @returns {Promise<{items: Array, stats: object, usage: object, latencyMs: number}>}
 */
async function hybridExtract(
  postTitle,
  cleanedContent,
  allItems,
  modelConfig = {}
) {
  const startTime = Date.now();

  // Run LLM extraction and algorithmic search in parallel
  const [llmResult, algoMatches] = await Promise.all([
    extractItemCandidates(postTitle, cleanedContent, modelConfig),
    Promise.resolve(algorithmicSearch(cleanedContent, allItems)),
  ]);

  // Extract items and usage from LLM result
  const llmCandidates = llmResult.items;
  let totalUsage = { ...llmResult.usage };

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
      confirmed.push({
        ...item,
        confidence: CONFIDENCE_SCORES.confirmed,
        source: 'both',
      });
    } else {
      llmOnly.push({
        ...item,
        confidence: CONFIDENCE_SCORES.llmOnly,
        source: 'llm',
      });
    }
  }

  // Collect algo-only candidates for LLM validation
  const algoOnlyCandidates = [];
  for (const [itemId, matchInfo] of algoMatches) {
    if (!llmItemIds.has(itemId)) {
      algoOnlyCandidates.push(matchInfo.item);
    }
  }

  // Validate algo-only candidates with a second LLM call
  if (algoOnlyCandidates.length > 0) {
    const validationResult = await validateAlgoCandidates(
      postTitle,
      cleanedContent,
      algoOnlyCandidates,
      modelConfig
    );

    // Aggregate token usage from second LLM call
    totalUsage.promptTokens += validationResult.usage.promptTokens;
    totalUsage.completionTokens += validationResult.usage.completionTokens;
    totalUsage.reasoningTokens += validationResult.usage.reasoningTokens;

    for (const item of validationResult.items) {
      algoOnly.push({
        ...item,
        confidence: CONFIDENCE_SCORES.algoValidated,
        source: 'algo_validated',
      });
    }
  }

  const latencyMs = Date.now() - startTime;

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
  };

  logger.debug('Hybrid extraction complete', {
    postTitle,
    ...stats,
  });

  return { items: allResults, stats, usage: totalUsage, latencyMs };
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
  validateAlgoCandidates,
  MIN_ALGO_SEARCH_LENGTH,
};
