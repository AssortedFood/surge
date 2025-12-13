// src/itemMatcher.js
import { GENERIC_WORDS } from './genericWords.js';

/**
 * Cleans a name by removing suffixes, parentheses, and non-alphanumeric characters.
 * @param {string | null | undefined} name The string to normalize.
 * @returns {string} The cleaned, lowercased string.
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\s*\([^)]+\)/g, '') // Remove text in parentheses, e.g. (4)
    .replace(/- broken$/, '') // Remove suffix '- broken'
    .replace(/[^a-z0-9\s]/g, '') // Remove remaining non-alphanumeric characters
    .trim();
}

/**
 * Extracts the significant, non-generic words from a cleaned name.
 * @param {string} cleanedName The name after normalization.
 * @returns {Set<string>} A set of significant words.
 */
function getSignificantWords(cleanedName) {
  return new Set(
    cleanedName.split(/\s+/).filter((word) => word && !GENERIC_WORDS.has(word))
  );
}

/**
 * Finds matching items within a given text content.
 * @param {string} rawText The raw text content of a news post.
 * @param {Array<object>} allItems An array of item objects to search for (from the database).
 * @returns {Array<{id: number, name: string}>} An array of matched items.
 */
export function findMatches(rawText, allItems) {
  const lowerCaseText = rawText.toLowerCase();

  // 1. Analyze the post text to get a set of all its significant words.
  const postWords = getSignificantWords(normalizeName(rawText));

  // 2. Identify all potential matches based on our hybrid rules.
  const potentialMatches = [];
  for (const item of allItems) {
    if (!item.name) continue;

    const cleanedItemName = normalizeName(item.name);
    const itemWords = getSignificantWords(cleanedItemName);
    const wordCount = itemWords.size;

    if (wordCount === 0) continue;

    let isMatch = false;
    if (wordCount >= 2) {
      // Rule for Multi-Word Items: Flexible subset match.
      isMatch = [...itemWords].every((word) => postWords.has(word));
    } else {
      // wordCount === 1
      // Rule for Single-Word Items: Strict phrase match.
      const pattern = new RegExp(`\\b${cleanedItemName}\\b`, 'i');
      isMatch = pattern.test(rawText);
    }

    if (isMatch) {
      potentialMatches.push({
        id: item.id,
        name: item.name,
        cleanedName: cleanedItemName,
        wordCount: wordCount,
        significantWords: itemWords,
      });
    }
  }

  // 3. Select the best match from the candidates to resolve ambiguity.
  const finalMatches = [];
  const seenIds = new Set();
  const matchedWords = new Set();

  // Sort by word count, then by phrase presence, then by name length.
  potentialMatches.sort((a, b) => {
    if (b.wordCount !== a.wordCount) {
      return b.wordCount - a.wordCount;
    }
    const aIsPhrase = lowerCaseText.includes(a.cleanedName);
    const bIsPhrase = lowerCaseText.includes(b.cleanedName);
    if (aIsPhrase && !bIsPhrase) return -1;
    if (!aIsPhrase && bIsPhrase) return 1;
    return b.name.length - a.name.length;
  });

  for (const match of potentialMatches) {
    const alreadyClaimed = [...match.significantWords].some((word) =>
      matchedWords.has(word)
    );
    if (alreadyClaimed) continue;

    if (!seenIds.has(match.id)) {
      finalMatches.push(match);
      seenIds.add(match.id);
      match.significantWords.forEach((word) => matchedWords.add(word));
    }
  }

  return finalMatches;
}
