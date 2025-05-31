// src/itemMatcher.js
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Determine __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

/**
 * Reads a plaintext post file and an item list JSON file, then returns
 * an array of item names that appear (case-insensitive) within the post text.
 *
 * @param {string} postFilePath    Path to the plaintext file (e.g., "data/posts/1 - SomePost.md")
 * @param {string} itemListPath    Path to the JSON file containing an array of items,
 *                                 each object must have a "name" property.
 * @returns {Promise<string[]>}    Array of matched item names.
 */
export async function findMatches(postFilePath, itemListPath) {
  // 1. Load and lower-case the post text
  const rawPost = await fs.readFile(postFilePath, "utf-8");
  const postText = rawPost.toLowerCase();

  // 2. Load the item list JSON (array of objects with "name" fields)
  const rawItems = await fs.readFile(itemListPath, "utf-8");
  let items;
  try {
    items = JSON.parse(rawItems);
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${itemListPath}: ${err.message}`);
  }

  // 3. For each item, check if its lower-case name occurs in postText
  const matches = [];
  for (const item of items) {
    if (!item.name) continue;
    const lowerName = item.name.toLowerCase();
    if (postText.includes(lowerName)) {
      matches.push(item.name);
    }
  }

  return matches;
}

/**
 * If this script is run directly via `node src/itemMatcher.js <postFile> <itemListJson>`,
 * it will print the matching item names to the console, one per line.
 */
if (process.argv.length === 4 && process.argv[1].endsWith("itemMatcher.js")) {
  const postArg     = process.argv[2];
  const itemListArg = process.argv[3];

  // Resolve paths relative to project root if necessary
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
