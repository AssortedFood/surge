// src/allItemsFetcher.js
import 'dotenv/config'; // Load environment variables from .env
import fetch from "node-fetch";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const dataDir    = resolve(__dirname, "../data");
const outputFile = resolve(dataDir, "all_items.json");

// Get URL and user-agent from environment variables
const mappingUrl = process.env.ITEM_LIST_URL;
const apiHeaders = {
  "User-Agent": process.env.USER_AGENT || "default-agent"
};

export async function fetchAndSaveAllItems() {
  try {
    const res = await fetch(mappingUrl, { headers: apiHeaders });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();

    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(outputFile, JSON.stringify(json, null, 2), "utf-8");
    console.log(`[allItemsFetcher] Saved ${json.length} items to ${outputFile}`);
  } catch (err) {
    console.error("[allItemsFetcher] Error:", err);
    throw err;
  }
}

// If run directly via `node src/allItemsFetcher.js`, invoke the fetch
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchAndSaveAllItems().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
