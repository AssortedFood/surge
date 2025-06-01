// src/itemMatcher.js
import 'dotenv/config'; // Load environment variables
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

/**
 * Escape any regex‐special characters in a string so we can interpolate it literally.
 */
function escapeRegex(str) {
  // from MDN: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads a plaintext post file and an item list JSON file, then returns
 * an array of item names that appear (case‐insensitive) within the post text,
 * matching whole words and allowing an optional trailing "s" or "'s".
 *
 * @param {string} postFilePath    Path to the plaintext file
 * @param {string} itemListPath    Path to the JSON file with "name" fields
 * @returns {Promise<string[]>}    Array of matched item names
 */
export async function findMatches(postFilePath, itemListPath) {
  const rawPost = await fs.readFile(postFilePath, "utf-8");
  const postText = rawPost.toLowerCase();

  const rawItems = await fs.readFile(itemListPath, "utf-8");
  let items;
  try {
    items = JSON.parse(rawItems);
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${itemListPath}: ${err.message}`);
  }

  const matches = [];
  for (const item of items) {
    if (!item.name) continue;

    // 1) Lowercase and escape any special regex chars in the item name.
    const lowerName = item.name.toLowerCase();
    const escapedName = escapeRegex(lowerName);

    // 2) Build a RegExp that matches the item name as a whole word, with an optional "s" or "'s" at the end.
    //
    //    \b           ← word boundary
    //    escapedName  ← the literal item name (escaped)
    //    (?:s|'s)?    ← optional plural/possessive suffix:
    //                     - an "s"  (for plurals),
    //                     - or "'s" (for possessive),
    //                     - or nothing
    //    \b           ← word boundary again
    //
    // Example if item.name = "Dragon scale":
    //    pattern = /\bdragon scale(?:s|'s)?\b/i
    //
    // That will match:
    //    "dragon scale", "Dragon Scales", "dragon scale's", etc.,
    // but not "redragon scales" or "dragonscale".
    const pattern = new RegExp(`\\b${escapedName}(?:s|'s)?\\b`, "i");

    if (pattern.test(postText)) {
      matches.push(item.name);
    }
  }

  return matches;
}

/**
 * If this script is run directly, attempt to load args or use defaults from .env
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const postArg     = process.argv[2];
  const itemListArg = process.argv[3] || process.env.ITEM_LIST_PATH;

  if (!postArg || !itemListArg) {
    console.error("Usage: node src/itemMatcher.js <postFile> <itemListJson> OR define ITEM_LIST_PATH in .env");
    process.exit(1);
  }

  const postFilePath = resolve(process.cwd(), postArg);
  const itemListPath = resolve(process.cwd(), itemListArg);

  findMatches(postFilePath, itemListPath)
    .then((matches) => {
      if (matches.length === 0) {
        console.log("No matches found.");
      } else {
        matches.forEach((name) => console.log(name));
      }
    })
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}
