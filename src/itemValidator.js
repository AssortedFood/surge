// src/itemValidator.js
// Validates LLM-extracted item candidates against the actual item database

import logger from './utils/logger.js';

/**
 * Calculates Levenshtein distance between two strings
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Normalizes an item name for matching
 * - Lowercase
 * - Remove parenthetical suffixes like (4), (p++), (or)
 * - Normalize hyphens/spaces
 * - Trim whitespace
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '') // Remove trailing parentheses
    .replace(/-/g, ' ') // Convert hyphens to spaces
    .replace(/\s+/g, ' ') // Normalize multiple spaces to single
    .trim();
}

/**
 * Creates additional normalized variants for matching
 * Handles common spelling/formatting differences
 * @param {string} name
 * @returns {string[]}
 */
function getNameVariants(name) {
  const base = name.toLowerCase().trim();
  const variants = [base];

  // Add hyphenated/non-hyphenated variants
  if (base.includes('-')) {
    variants.push(base.replace(/-/g, ' ')); // "anti-venom" -> "anti venom"
    variants.push(base.replace(/-/g, '')); // "anti-venom" -> "antivenom"
  }
  if (base.includes(' ')) {
    variants.push(base.replace(/ /g, '-')); // "anti venom" -> "anti-venom"
    variants.push(base.replace(/ /g, '')); // "anti venom" -> "antivenom"
  }

  // Add variant without apostrophes
  if (base.includes("'")) {
    variants.push(base.replace(/'/g, '')); // "inquisitor's" -> "inquisitors"
  }

  // Without trailing parentheses
  const noParens = base.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (noParens !== base) {
    variants.push(noParens);
  }

  return [...new Set(variants)]; // Dedupe
}

/**
 * Finds the closest matching item using fuzzy search
 * @param {string} candidateName
 * @param {Array<{id: number, name: string}>} items
 * @param {Object} options
 * @param {number} options.maxDistance - Maximum Levenshtein distance to consider a match
 * @returns {{id: number, name: string} | null}
 */
function findClosestMatch(candidateName, items, { maxDistance = 2 } = {}) {
  const normalizedCandidate = candidateName.toLowerCase();
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const item of items) {
    const normalizedItem = item.name.toLowerCase();
    const distance = levenshteinDistance(normalizedCandidate, normalizedItem);

    if (distance < bestDistance && distance <= maxDistance) {
      bestDistance = distance;
      bestMatch = item;
    }
  }

  return bestMatch;
}

/**
 * Validates LLM-extracted item candidates against the item database.
 * Uses multiple matching strategies: exact, normalized, variants, fuzzy.
 *
 * @param {Array<{name: string, snippet: string, context: string}>} candidates - LLM-extracted items
 * @param {Array<{id: number, name: string}>} allItems - All items from database
 * @returns {Array<{name: string, snippet: string, context: string, itemId: number, itemName: string}>}
 */
function validateItemCandidates(candidates, allItems) {
  const validated = [];
  const seenItemIds = new Set();

  // Build lookup maps for faster matching
  const exactMap = new Map();
  const normalizedMap = new Map();
  const variantMap = new Map();

  for (const item of allItems) {
    const lower = item.name.toLowerCase();
    exactMap.set(lower, item);

    const normalized = normalizeName(item.name);
    // Only set if not already present (prefer first/exact match)
    if (!normalizedMap.has(normalized)) {
      normalizedMap.set(normalized, item);
    }

    // Add all variants of the item name
    for (const variant of getNameVariants(item.name)) {
      if (!variantMap.has(variant)) {
        variantMap.set(variant, item);
      }
    }
  }

  for (const candidate of candidates) {
    const candidateLower = candidate.name.toLowerCase();
    const candidateNormalized = normalizeName(candidate.name);
    const candidateVariants = getNameVariants(candidate.name);

    let match = null;

    // 1. Try exact match (case-insensitive)
    match = exactMap.get(candidateLower);

    // 2. Try normalized match (remove parentheses, normalize spaces/hyphens)
    if (!match) {
      match = normalizedMap.get(candidateNormalized);
    }

    // 3. Try variant matching (handles "anti venom" vs "anti-venom" etc.)
    if (!match) {
      for (const variant of candidateVariants) {
        match = variantMap.get(variant);
        if (match) break;
      }
    }

    // 4. Try fuzzy match (Levenshtein distance <= 2)
    if (!match) {
      match = findClosestMatch(candidate.name, allItems, { maxDistance: 2 });
    }

    if (match && !seenItemIds.has(match.id)) {
      seenItemIds.add(match.id);
      validated.push({
        ...candidate,
        itemId: match.id,
        itemName: match.name, // Use canonical DB name
      });

      logger.debug('Validated item candidate', {
        candidate: candidate.name,
        matched: match.name,
        itemId: match.id,
      });
    } else if (!match) {
      logger.debug('Item candidate not found in database', {
        candidate: candidate.name,
      });
    }
  }

  return validated;
}

export {
  validateItemCandidates,
  normalizeName,
  getNameVariants,
  levenshteinDistance,
};
