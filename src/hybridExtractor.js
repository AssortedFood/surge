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
const DEFAULT_REASONING_EFFORT =
  process.env.OPENAI_REASONING_EFFORT || 'medium';

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
// Greedy matching mode - also match items by their first word (e.g., "Virtus" → "Virtus mask")
const GREEDY_MATCHING = process.env.GREEDY_MATCHING === 'true';

// Additional blocklist for greedy prefix matching (common words that match too many items)
const GREEDY_PREFIX_BLOCKLIST = new Set([
  // Common words that appear in posts but match many items
  'blighted',
  'blood',
  'combat',
  'crystal',
  'light',
  'fire',
  'energy',
  'ancient',
  'super',
  'divine',
  'small',
  'large',
  'blessed',
  'holy',
  'dark',
  'soul',
  'spirit',
  'death',
  'chaos',
  'nature',
  'earth',
  'water',
  'smoke',
  'steam',
  'dust',
  'lava',
  'mud',
  'shadow',
  'arcane',
  'mystic',
  'void',
  'elite',
  'master',
  'team',
  'bounty',
  'hunter',
  'fishing',
  'slayer',
  'cannon',
  'infernal',
  'barrows',
]);

function algorithmicSearch(content, allItems, greedy = GREEDY_MATCHING) {
  const found = new Map();
  const contentLower = content.toLowerCase();

  // For greedy mode, extract all words from content for prefix matching
  const contentWords = greedy
    ? new Set(contentLower.match(/\b[a-z]{4,}\b/g) || [])
    : null;

  for (const item of allItems) {
    const nameLower = item.name.toLowerCase();

    // Skip items that are too short or blocklisted
    if (nameLower.length < MIN_ALGO_SEARCH_LENGTH) continue;
    if (ALGO_BLOCKLIST.has(nameLower)) continue;

    // Also check base name without parenthetical suffix for blocklist
    const baseName = nameLower.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (ALGO_BLOCKLIST.has(baseName)) continue;

    // Try exact substring match first (fast path)
    let matchType = null;
    if (contentLower.includes(nameLower)) {
      // Verify with word boundary regex (slower but accurate)
      // This prevents "gold" matching inside "marigold"
      try {
        const pattern = new RegExp(`\\b${escapeRegex(nameLower)}\\b`, 'i');
        if (pattern.test(content)) {
          matchType = 'exact';
        }
      } catch {
        // If regex fails (shouldn't happen), skip this item
        continue;
      }
    }

    // Greedy mode: also match if first word of item name appears in content
    // e.g., "Virtus" in content → match "Virtus mask", "Virtus robe top"
    if (!matchType && greedy && contentWords) {
      // Normalize: remove possessive "'s" to match "inquisitor's" → "inquisitor"
      const firstWord = nameLower.split(/\s+/)[0].replace(/'s$/, '');
      if (
        firstWord.length >= 4 &&
        !ALGO_BLOCKLIST.has(firstWord) &&
        !GREEDY_PREFIX_BLOCKLIST.has(firstWord) &&
        contentWords.has(firstWord)
      ) {
        matchType = 'greedy';
      }
    }

    if (matchType) {
      found.set(item.id, {
        item,
        matchType,
      });
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

  const systemPrompt = `You are an Old School RuneScape expert. You will be given a list of potential item names found in a news post. Your job is to determine which ones are ACTUALLY being mentioned as real OSRS items.

Rules:
- Mark items as relevant if they refer to real tradeable OSRS items, even if just mentioned briefly (bug fixes, comparisons, requirements, etc.)
- "Bones" appearing in "bare bones" or "backbone" is NOT relevant (not referring to the item)
- Item names that are JMod names (Ash, Acorn, etc.) are NOT relevant
- Generic words that happen to match item names but aren't referring to items are NOT relevant`;

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
            confidence: 0.8, // High confidence since LLM validated the algo match
            mentionType: 'direct',
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
    // Use LLM's confidence if provided, otherwise use source-based defaults
    const llmConfidence = item.confidence ?? 0.9;

    if (algoMatches.has(item.itemId)) {
      confirmed.push({
        ...item,
        confidence: Math.max(llmConfidence, CONFIDENCE_SCORES.confirmed),
        source: 'both',
      });
    } else {
      llmOnly.push({
        ...item,
        confidence: Math.min(llmConfidence, CONFIDENCE_SCORES.llmOnly),
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

/**
 * Multi-run voting extraction: runs hybridExtract N times and aggregates results
 * Items that appear in at least votingThreshold% of runs are included
 * This reduces variance by requiring consensus across multiple extractions
 *
 * @param {string} postTitle - The post title
 * @param {string} cleanedContent - The cleaned post content
 * @param {Array<{id: number, name: string}>} allItems - All items from database
 * @param {object} modelConfig - Model configuration {model, reasoning}
 * @param {number} numRuns - Number of extraction runs (default 3)
 * @param {number} votingThreshold - Min appearance ratio to include (default 0.6 = 60%)
 * @returns {Promise<{items: Array, votingStats: object, usage: object, latencyMs: number}>}
 */
async function hybridExtractWithVoting(
  postTitle,
  cleanedContent,
  allItems,
  modelConfig = {},
  numRuns = 3,
  votingThreshold = 0.6
) {
  const startTime = Date.now();

  logger.debug('Starting voting extraction', {
    postTitle,
    numRuns,
    votingThreshold,
  });

  // Run N extractions in parallel
  const allRuns = await Promise.all(
    Array(numRuns)
      .fill()
      .map(() =>
        hybridExtract(postTitle, cleanedContent, allItems, modelConfig)
      )
  );

  // Aggregate votes per item
  const itemVotes = new Map(); // itemId -> { appearances, scores, sources, items }

  for (const run of allRuns) {
    for (const item of run.items) {
      const vote = itemVotes.get(item.itemId) || {
        appearances: 0,
        scores: [],
        sources: [],
        items: [],
      };
      vote.appearances++;
      vote.scores.push(item.confidence);
      vote.sources.push(item.source);
      vote.items.push(item);
      itemVotes.set(item.itemId, vote);
    }
  }

  // Filter by voting threshold and compute aggregated confidence
  const votedItems = [];
  for (const [, vote] of itemVotes) {
    const appearanceRatio = vote.appearances / numRuns;
    if (appearanceRatio >= votingThreshold) {
      // Use the item with highest confidence as the representative
      const bestItem = vote.items.reduce((a, b) =>
        a.confidence > b.confidence ? a : b
      );

      // Compute aggregated confidence from voting results
      const avgConfidence =
        vote.scores.reduce((a, b) => a + b, 0) / vote.scores.length;

      // Source consistency: 1.0 if all same, lower if varied
      const uniqueSources = new Set(vote.sources).size;
      const sourceConsistency = 1.0 / uniqueSources;

      // Final score: weighted combination
      const votingConfidence =
        0.5 * appearanceRatio + 0.3 * avgConfidence + 0.2 * sourceConsistency;

      votedItems.push({
        ...bestItem,
        confidence: Math.max(avgConfidence, votingConfidence),
        votingStats: {
          appearances: vote.appearances,
          totalRuns: numRuns,
          appearanceRatio,
          avgConfidence,
          sourceConsistency,
        },
      });
    }
  }

  // Sort by confidence
  votedItems.sort((a, b) => b.confidence - a.confidence);

  // Aggregate usage across all runs
  const totalUsage = {
    promptTokens: allRuns.reduce((sum, r) => sum + r.usage.promptTokens, 0),
    completionTokens: allRuns.reduce(
      (sum, r) => sum + r.usage.completionTokens,
      0
    ),
    reasoningTokens: allRuns.reduce(
      (sum, r) => sum + r.usage.reasoningTokens,
      0
    ),
  };

  const latencyMs = Date.now() - startTime;

  const votingStats = {
    runsExecuted: numRuns,
    votingThreshold,
    uniqueItemsSeen: itemVotes.size,
    itemsAfterVoting: votedItems.length,
    itemsFiltered: itemVotes.size - votedItems.length,
  };

  logger.debug('Voting extraction complete', {
    postTitle,
    ...votingStats,
  });

  return { items: votedItems, votingStats, usage: totalUsage, latencyMs };
}

/**
 * Single-pass hybrid extraction: runs algo search first, passes economically
 * significant hints to LLM extraction (no separate validation call)
 *
 * @param {string} postTitle - The post title
 * @param {string} cleanedContent - The cleaned post content
 * @param {Array<{id: number, name: string, value?: number, limit?: number}>} allItems - All items from database
 * @param {object} modelConfig - Optional model configuration {model, reasoning}
 * @param {number} marginThreshold - Economic significance threshold (default 1M)
 * @returns {Promise<{items: Array, stats: object, usage: object, latencyMs: number}>}
 */
async function hybridExtractSinglePass(
  postTitle,
  cleanedContent,
  allItems,
  modelConfig = {},
  marginThreshold = 1000000
) {
  const startTime = Date.now();

  // Build lookup for economic significance
  const itemById = new Map(allItems.map((i) => [i.id, i]));
  const isSignificant = (itemId) => {
    const item = itemById.get(itemId);
    if (!item) return false;
    const margin = (item.value || 0) * (item.limit || 0);
    return margin >= marginThreshold;
  };

  // Run algorithmic search first (with greedy mode)
  const algoMatches = algorithmicSearch(cleanedContent, allItems, true);

  // Filter to economically significant items only
  const candidateHints = [...algoMatches.entries()]
    .filter(([itemId]) => isSignificant(itemId))
    .map(([, matchInfo]) => matchInfo.item.name);

  logger.debug('Single-pass: algo candidates found', {
    postTitle,
    totalMatches: algoMatches.size,
    significantHints: candidateHints.length,
  });

  // Run LLM extraction with hints
  const llmResult = await extractItemCandidates(
    postTitle,
    cleanedContent,
    modelConfig,
    candidateHints
  );

  // Validate LLM candidates against database
  const llmValidated = validateItemCandidates(llmResult.items, allItems);

  // Build results with confidence scores
  const items = llmValidated.map((item) => {
    const wasAlgoMatch = algoMatches.has(item.itemId);
    return {
      ...item,
      confidence: wasAlgoMatch
        ? CONFIDENCE_SCORES.confirmed
        : CONFIDENCE_SCORES.llmOnly,
      source: wasAlgoMatch ? 'both' : 'llm',
    };
  });

  const latencyMs = Date.now() - startTime;

  const stats = {
    algoCandidates: candidateHints.length,
    llmExtracted: llmResult.items.length,
    validated: items.length,
    confirmed: items.filter((i) => i.source === 'both').length,
  };

  logger.debug('Single-pass extraction complete', {
    postTitle,
    ...stats,
    latencyMs,
  });

  return { items, stats, usage: llmResult.usage, latencyMs };
}

/**
 * Inline embedding extraction: embeds item hints directly next to their
 * trigger keywords in the content using «» syntax.
 *
 * IMPORTANT: Pass pre-filtered economically significant items. This function
 * uses the items list directly without additional filtering.
 *
 * @param {string} postTitle - The post title
 * @param {string} cleanedContent - The cleaned post content
 * @param {Array<{id: number, name: string}>} significantItems - Pre-filtered economically significant items
 * @param {object} modelConfig - Optional model configuration {model, reasoning}
 * @returns {Promise<{items: Array, stats: object, usage: object, latencyMs: number}>}
 */
async function hybridExtractInline(
  postTitle,
  cleanedContent,
  significantItems,
  modelConfig = {}
) {
  const startTime = Date.now();

  // Run algorithmic search with greedy mode on significant items
  const algoMatches = algorithmicSearch(cleanedContent, significantItems, true);

  // Group items by their trigger keyword (first word, normalized)
  const triggerToItems = new Map();
  for (const [, matchInfo] of algoMatches) {
    const itemName = matchInfo.item.name;
    // Normalize: remove possessive "'s" to match content words
    const trigger = itemName.split(/\s+/)[0].toLowerCase().replace(/'s$/, '');

    if (!triggerToItems.has(trigger)) {
      triggerToItems.set(trigger, []);
    }
    triggerToItems.get(trigger).push(itemName);
  }

  // Embed suggestions inline using «» syntax
  let annotatedContent = cleanedContent;
  for (const [trigger, itemNames] of triggerToItems) {
    // Limit to 5 suggestions per trigger to avoid overwhelming the prompt
    const suggestions = itemNames.slice(0, 5).join(', ');
    // Replace first occurrence of trigger word with trigger + suggestions
    const regex = new RegExp(`\\b(${escapeRegex(trigger)})\\b`, 'i');
    annotatedContent = annotatedContent.replace(regex, `$1 «${suggestions}»`);
  }

  logger.debug('Inline embedding: annotated content', {
    postTitle,
    triggers: triggerToItems.size,
    totalHints: [...triggerToItems.values()].reduce(
      (sum, arr) => sum + arr.length,
      0
    ),
  });

  // Build custom system prompt with inline syntax explanation
  const model = modelConfig.model || DEFAULT_MODEL;
  const reasoning = modelConfig.reasoning || DEFAULT_REASONING_EFFORT;

  const inlineSystemPrompt = `You are an Old School RuneScape expert. Extract tradeable items that are EXPLICITLY mentioned in this news post.

INLINE SUGGESTIONS: The content contains hints in «item1, item2» format next to trigger words. These are algorithmically-detected item names that may be relevant. Use greedy matching:
- If "Virtus" appears with «Virtus mask, Virtus robe top, Virtus robe bottom», extract ALL those items since "Virtus" refers to the set
- If "cannonball" appears with «Cannonball», extract Cannonball
- ONLY include suggestions if the trigger word genuinely refers to the item (not coincidental matches)

CRITICAL: Only extract items that are actually discussed in the post. Do NOT speculatively expand categories or guess at items.

Rules:
- Only include items tradeable on the Grand Exchange
- Extract items that are NAMED or CLEARLY IMPLIED in the text
- If a specific item is named (e.g., "Dragon Bones", "Wyrm Bones"), extract it
- Do NOT expand generic category words into full lists (e.g., "bones" alone → don't list all bone types)
- Do NOT include: quest items, untradeable rewards, currencies (coins/gp), NPCs, locations, skills
- When an armor SET is mentioned by name (e.g., "Virtus", "Inquisitor's"), include ALL individual pieces

FALSE POSITIVES TO AVOID:
- "staff" referring to Jagex employees (NOT Staff of X items)
- JMod names that match items: Ash, Grace, Acorn, Pumpkin
- Generic category words without specific items
- Ignore «» suggestions if the trigger word isn't actually referring to an item

Context classifications:
- buff: Item being made stronger
- nerf: Item being made weaker
- supply_change: Drop rate or availability changing
- new_content: New item being added
- bug_fix: Bug fix related to item
- mention_only: Item mentioned without gameplay change

OUTPUT REQUIREMENTS:
1. name: Exact item name as it appears in-game
2. snippet: Text where item is mentioned (max 400 chars, exclude «» annotations)
3. context: One of the classifications above
4. confidence: 0.0-1.0 (0.9+ for explicit mentions, lower for implied)
5. mentionType: "direct" (named), "implied" (referenced indirectly), or "category_expansion" (expanded from set name)
6. variantCategory: Only if expanded from a set/category name, otherwise null`;

  const userMessage = `Post Title: "${postTitle}"

Content (with inline «suggestions»):
"""
${annotatedContent}
"""

Extract all tradeable OSRS items mentioned in this post. Use the «» suggestions as hints for greedy matching when the trigger word refers to item sets or variants.`;

  try {
    const rawResponse = await fetchStructuredResponse(
      model,
      inlineSystemPrompt,
      userMessage,
      (await import('../schemas/ItemExtractionSchema.js')).ItemExtractionSchema,
      { reasoningEffort: reasoning }
    );

    const usage = {
      promptTokens: rawResponse.usage?.prompt_tokens || 0,
      completionTokens: rawResponse.usage?.completion_tokens || 0,
      reasoningTokens:
        rawResponse.usage?.completion_tokens_details?.reasoning_tokens || 0,
    };

    const message = rawResponse.choices?.[0]?.message;
    let result;
    if (message?.parsed) {
      result = message.parsed;
    } else if (message?.content) {
      result = JSON.parse(message.content);
    } else {
      result = { items: [] };
    }

    // Validate LLM candidates against significant items only
    // This ensures we only return items that pass the economic threshold
    const llmValidated = validateItemCandidates(
      result.items || [],
      significantItems
    );

    // Build results with confidence scores
    const items = llmValidated.map((item) => {
      const wasAlgoMatch = algoMatches.has(item.itemId);
      return {
        ...item,
        confidence: wasAlgoMatch
          ? CONFIDENCE_SCORES.confirmed
          : CONFIDENCE_SCORES.llmOnly,
        source: wasAlgoMatch ? 'both' : 'llm',
      };
    });

    const latencyMs = Date.now() - startTime;

    const stats = {
      triggers: triggerToItems.size,
      totalHints: [...triggerToItems.values()].reduce(
        (sum, arr) => sum + arr.length,
        0
      ),
      llmExtracted: (result.items || []).length,
      validated: items.length,
    };

    logger.debug('Inline extraction complete', {
      postTitle,
      ...stats,
      latencyMs,
    });

    return { items, stats, usage, latencyMs };
  } catch (err) {
    logger.error('Inline extraction failed', {
      error: err.message,
      postTitle,
    });
    throw err;
  }
}

export {
  hybridExtract,
  hybridExtractWithVoting,
  hybridExtractSinglePass,
  hybridExtractInline,
  algorithmicSearch,
  filterByConfidence,
  validateAlgoCandidates,
  MIN_ALGO_SEARCH_LENGTH,
};
