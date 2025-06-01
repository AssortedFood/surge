<<<<<<< HEAD
=======
// src/index.js
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import fs from 'fs/promises';

import { getNewRssPosts } from './rssChecker.js';
import { fetchAndSaveAllItems } from './allItemsFetcher.js';
import { fetchAndSavePost as originalFetchAndSavePost } from './rssPostFetcher.js';
import { findMatches } from './itemMatcher.js';
import { analyzeItemImpact } from './semanticItemAnalysis.js';
import { sendTelegramMessage } from './sendTelegram.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read a JSON array from .env (or fall back to a default)
let INCLUDED_CHANGE_TYPES = ['Price increase', 'Price decrease', 'No change'];
if (process.env.INCLUDED_CHANGE_TYPES) {
  try {
    INCLUDED_CHANGE_TYPES = JSON.parse(process.env.INCLUDED_CHANGE_TYPES);
  } catch (e) {
    console.warn(
      'Warning: INCLUDED_CHANGE_TYPES in .env is not valid JSON. ' +
      'Falling back to default.'
    );
  }
}

// How often to check RSS (in seconds)
const RSS_CHECK_INTERVAL = parseInt(process.env.RSS_CHECK_INTERVAL, 10) || 60;

const DATA_DIR = resolve(__dirname, '../data');
const POSTS_DIR = join(DATA_DIR, 'posts');
const ANALYSIS_DIR = join(DATA_DIR, 'analysis');
const ALL_ITEMS_PATH = join(DATA_DIR, 'all_items.json');

/**
 * Simple sleep helper for retry delays.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap fetchAndSavePost with a retry loop for HTTP 502s.
 * Tries up to maxAttempts times, waiting 2 seconds between attempts.
 */
async function fetchAndSavePost(postId, maxAttempts = 3) {
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await originalFetchAndSavePost(postId);
      return; // success
    } catch (err) {
      lastErr = err;
      if (err.message.includes('HTTP 502') && attempt < maxAttempts) {
        console.log(`🔄 502 on post ${postId}, retrying attempt ${attempt + 1}/${maxAttempts} in 3s…`);
        await sleep(3000);
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

/**
 * Analyze one item for a given post.
 * Writes the result (or error) to disk and conditionally sends a Telegram message.
 */
async function analyzeOneItem(postId, itemId, itemName) {
  const analysisPath = join(ANALYSIS_DIR, String(postId));
  console.log(`⚙️ Starting analysis for item “${itemName}” (ID: ${itemId}) in post ${postId}.`);
  
  try {
    const result = await analyzeItemImpact(
      join(POSTS_DIR, `${postId}.txt`),
      itemName
    );
    const output = {
      relevant_text_snippet: result.relevant_text_snippet,
      expected_price_change: result.expected_price_change,
    };

    // 1. Write the raw JSON to disk
    const filePath = join(analysisPath, `${itemId}.json`);
    await fs.writeFile(filePath, JSON.stringify(output, null, 2), 'utf-8');

    // 2. Only send Telegram if this change type is included
    if (INCLUDED_CHANGE_TYPES.includes(output.expected_price_change)) {
      // Pick a “circle + arrow” emoji:
      let emoji;
      if (output.expected_price_change === 'Price increase') {
        emoji = '🟢';
      } else if (output.expected_price_change === 'Price decrease') {
        emoji = '🔴';
      } else {
        emoji = '🟡'; // “No change”
      }

      // Build an HTML‐bold message (since we use parse_mode='HTML'):
      const msg = [
        `<b>${itemName}</b>`,
        ``,
        `“${output.relevant_text_snippet}”`,
        ``,
        `${emoji} ${output.expected_price_change}`
      ].join('\n');

      await sendTelegramMessage(msg);
      console.log(`✉️ Sent analysis result for item “${itemName}” (ID: ${itemId}) in post ${postId}.`);
    } else {
      console.log(
        `ℹ️ Skipped Telegram for item “${itemName}” (ID: ${itemId}) – ` +
        `change type “${output.expected_price_change}” not included.`
      );
    }
  } catch (err) {
    const errorObj = { error: err.message };
    const errPath = join(analysisPath, `${itemId}.error.json`);
    await fs.writeFile(errPath, JSON.stringify(errorObj, null, 2), 'utf-8');

    const errMsg = [
      `⚠️ Analysis failed for item “${itemName}” (ID: ${itemId}):`,
      `${err.message}`,
    ].join('\n');
    await sendTelegramMessage(errMsg);

    console.log(`⚠️ Sent analysis error for item “${itemName}” (ID: ${itemId}) in post ${postId}.`);
  }
}

/**
 * Process one RSS post: fetch its text (with retries), find matching items,
 * send a “new post” Telegram notification, and spawn per-item analyses.
 */
async function processOnePost(postId, title, link) {
  try {
    // 1. Fetch and save post text with retry → data/posts/{postId}.txt
    await fetchAndSavePost(postId);
    console.log(`📥 Post ${postId} fetched and saved.`);

    // 2. Find matching items by ID & name
    const matchedItems = await findMatches(
      join(POSTS_DIR, `${postId}.txt`),
      ALL_ITEMS_PATH
    );
    console.log(`🔍 Post ${postId} matched ${matchedItems.length} item(s).`);

    if (!matchedItems || matchedItems.length === 0) {
      console.log(`ℹ️ No tracked items found in post ${postId}.`);
      return;
    }

    // 3. Send “new post” Telegram message immediately
    const headerMsg = [
      `📰 New post: “${title}”`,
      `🔗 ${link}`,
    ].join('\n');
    await sendTelegramMessage(headerMsg);
    console.log(`✉️ Sent “new post” notification for post ${postId}.`);

    // 4. Create analysis folder: data/analysis/{postId}/
    const analysisPath = join(ANALYSIS_DIR, String(postId));
    await fs.mkdir(analysisPath, { recursive: true });

    // 5. For each matched item, spawn analyzeOneItem in parallel
    for (const { id: itemId, name: itemName } of matchedItems) {
      analyzeOneItem(postId, itemId, itemName);
    }
  } catch (err) {
    console.error(`❌ Error processing post ${postId}:`, err);
    const errMsg = [
      `⚠️ Failed to process post ID ${postId}:`,
      `${err.message}`,
    ].join('\n');
    await sendTelegramMessage(errMsg);
    console.log(`⚠️ Sent post-processing error notification for post ${postId}.`);
  }
}

/**
 * Poll the RSS feed; for any new posts, refresh the item list once,
 * then dispatch processing for each post in parallel.
 */
async function pollRss() {
  try {
    const newPosts = await getNewRssPosts();
    if (!newPosts || newPosts.length === 0) {
      return;
    }

    console.log(`🔔 Found ${newPosts.length} new post(s): ${newPosts.map(p => p.id).join(', ')}.`);

    // Refresh master item list once per batch
    await fetchAndSaveAllItems();
    console.log(`🔄 Master item list refreshed.`);

    // For each new post, process it without awaiting
    for (const { id: postId, title, link } of newPosts) {
      processOnePost(postId, title, link);
    }
  } catch (err) {
    console.error('❌ Error in pollRss:', err);
    const errMsg = [
      `⚠️ RSS polling error:`,
      `${err.message}`,
    ].join('\n');
    await sendTelegramMessage(errMsg);
    console.log(`⚠️ Sent RSS polling error notification.`);
  }
}

/**
 * Ensure top-level data directories exist before starting.
 */
async function ensureDirectories() {
  await fs.mkdir(POSTS_DIR, { recursive: true });
  await fs.mkdir(ANALYSIS_DIR, { recursive: true });
  console.log('📂 Ensured data directories exist.');
}

(async () => {
  // 1. Create necessary directories
  await ensureDirectories();

  // 2. Initial poll immediately
  await pollRss();

  // 3. Schedule recurring polls
  setInterval(pollRss, RSS_CHECK_INTERVAL * 1000);
  console.log(`⏰ Scheduled RSS polling every ${RSS_CHECK_INTERVAL} seconds.`);
})();
>>>>>>> 0ccc1f9 (refactor: INCLUDED_CHANGE_TYPES from index.js to .env)
