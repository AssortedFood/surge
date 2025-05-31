// src/allItemsFetcher.js
import fetch from "node-fetch";
import fs from "fs/promises";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Load config.json by reading it from disk and JSON‐parsing it
const rawConfig = readFileSync(resolve(__dirname, "../config.json"), "utf-8");
const config    = JSON.parse(rawConfig);

const dataDir    = resolve(__dirname, "../data");
const outputFile = resolve(dataDir, "all_items.json");

// Use the mapping URL from config.json
const mappingUrl = config.itemListUrl;

// Hardcoded User-Agent header as required by the OSRS prices API
const apiHeaders = {
  "User-Agent": "surge: item-price-analysis-bot - @oxidising on Discord"
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
