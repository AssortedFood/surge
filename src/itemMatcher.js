// src/itemMatcher.js
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { GENERIC_WORDS } from './genericWords.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\s*\([^)]+\)/g, '') // Remove text in parentheses, e.g. (4)
    .replace(/- broken$/, '')      // Remove suffix '- broken'
    .replace(/[^a-z0-9\s]/g, '')    // Remove remaining non-alphanumeric characters
    .trim();
}

function getSignificantWords(cleanedName) {
  return new Set(cleanedName.split(/\s+/).filter(word => word && !GENERIC_WORDS.has(word)));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function findMatches(postFilePath, itemListPath) {
  let rawText;
  try {
    rawText = await fs.readFile(postFilePath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const allItems = JSON.parse(await fs.readFile(itemListPath, 'utf-8'));
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
      isMatch = [...itemWords].every(word => postWords.has(word));
    } else { // wordCount === 1
      const pattern = new RegExp(`\\b${escapeRegex(cleanedItemName)}\\b`, 'i');
      isMatch = pattern.test(rawText);
    }

    if (isMatch) {
      potentialMatches.push({
        id: item.id,
        name: item.name,
        cleanedName: cleanedItemName, // Pass this through for the sort
        wordCount: wordCount,
        significantWords: itemWords,
      });
    }
  }

  // 3. Select the best match from the candidates to resolve ambiguity.
  const finalMatches = [];
  const seenIds = new Set();
  const matchedWords = new Set();

  // Sort by word count (most specific) first, then by our new tie-breaker.
  potentialMatches.sort((a, b) => {
    // Primary sort: more significant words is always better.
    if (b.wordCount !== a.wordCount) {
      return b.wordCount - a.wordCount;
    }

    // --- NEW TIE-BREAKER LOGIC ---
    // If word counts are equal, check if one appears as a literal phrase and the other doesn't.
    const aIsPhrase = lowerCaseText.includes(a.cleanedName);
    const bIsPhrase = lowerCaseText.includes(b.cleanedName);

    if (aIsPhrase && !bIsPhrase) {
      return -1; // a is better, sort it first.
    }
    if (!aIsPhrase && bIsPhrase) {
      return 1; // b is better, sort it first.
    }
    // --- END NEW TIE-BREAKER ---

    // Final fallback tie-breaker: longer original name.
    return b.name.length - a.name.length;
  });

  for (const match of potentialMatches) {
    // Check if a more specific item has already "claimed" the words in this item.
    const alreadyClaimed = [...match.significantWords].some(word => matchedWords.has(word));
    if (alreadyClaimed) continue;

    if (!seenIds.has(match.id)) {
      finalMatches.push({ id: match.id, name: match.name });
      seenIds.add(match.id);
      // "Claim" the words from this match so less specific items are ignored.
      match.significantWords.forEach(word => matchedWords.add(word));
    }
  }

  return finalMatches;
}


// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const postArg = process.argv[2];
  const itemListArg = process.argv[3] || process.env.ITEM_LIST_PATH;
  if (!postArg || !itemListArg) {
    console.error('Usage: node src/itemMatcher.js <postFile> <itemListJson>');
    process.exit(1);
  }
  const postPath = resolve(process.cwd(), postArg);
  const itemPath = resolve(process.cwd(), itemListArg);
  findMatches(postPath, itemPath)
    .then((arr) => {
      if (arr.length === 0) console.log('No matches found.');
      else {
        arr.sort((a, b) => a.name.localeCompare(b.name));
        arr.forEach(({ id, name }) => console.log(`${id}: ${name}`));
      }
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}