// src/itemMatcher.js
import 'dotenv/config'; // Load environment variables
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

/**
 * Reads a plaintext post file and an item list JSON file, then returns
 * an array of item names that appear (case-insensitive) within the post text.
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
    const lowerName = item.name.toLowerCase();
    if (postText.includes(lowerName)) {
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
