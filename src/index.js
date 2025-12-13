// src/index.js
import 'dotenv/config';
import { PrismaClient, PriceChange } from '@prisma/client';

// Import all necessary functions from other modules
import { findMatches } from './itemMatcher.js';
import { analyzeItemImpact } from './semanticItemAnalysis.js';
import { sendTelegramMessage } from './sendTelegram.js';
import { getEconomicallySignificantItems } from './itemFilter.js';
import { syncItemsAndPrices } from './syncData.js';
import { syncNewPosts } from './syncPosts.js';

const prisma = new PrismaClient();

// --- Configuration from .env ---
const DATA_SYNC_INTERVAL_MINUTES =
  parseInt(process.env.DATA_SYNC_INTERVAL_MINUTES, 10) || 360;
const RATE_LIMIT_SECONDS = parseInt(process.env.RATE_LIMIT_SECONDS, 10) || 60;
const INCLUDED_CHANGE_TYPES = process.env.INCLUDED_CHANGE_TYPES
  ? JSON.parse(process.env.INCLUDED_CHANGE_TYPES)
  : ['Price increase', 'Price decrease', 'No change'];

// --- Keys for storing last-run timestamps ---
const LAST_DATA_SYNC_KEY = 'lastDataSyncTimestamp';

// --- Scheduler for Infrequent Data Sync ---
async function shouldRunDataSync() {
  const lastRunState = await prisma.appState.findUnique({
    where: { key: LAST_DATA_SYNC_KEY },
  });
  if (!lastRunState) return true;

  const lastRunTime = new Date(lastRunState.value);
  const now = new Date();
  const minutesSinceLastRun = (now.getTime() - lastRunTime.getTime()) / 60000;
  return minutesSinceLastRun > DATA_SYNC_INTERVAL_MINUTES;
}

async function updateLastDataSync() {
  const now = new Date().toISOString();
  await prisma.appState.upsert({
    where: { key: LAST_DATA_SYNC_KEY },
    update: { value: now },
    create: { key: LAST_DATA_SYNC_KEY, value: now },
  });
}

async function runDataSyncScheduler() {
  console.log('--- Scheduler checking for due data sync ---');
  if (await shouldRunDataSync()) {
    console.log(
      `[SCHEDULER] Triggering item & price data sync (interval: ${DATA_SYNC_INTERVAL_MINUTES} mins)...`
    );
    try {
      await syncItemsAndPrices();
      await updateLastDataSync();
      console.log(`[SCHEDULER] Item & price data sync finished.`);
    } catch (err) {
      console.error('[SCHEDULER] Error during item & price data sync:', err);
    }
  }
}

// --- Analysis Logic ---
function toPriceChangeEnum(changeString) {
  switch (changeString) {
    case 'Price increase':
      return PriceChange.PriceIncrease;
    case 'Price decrease':
      return PriceChange.PriceDecrease;
    default:
      return PriceChange.NoChange;
  }
}

async function analyzeOneItem(post, item) {
  console.log(
    `⚙️ Starting analysis for item “${item.name}” (ID: ${item.id}) in post ${post.id}.`
  );
  try {
    const result = await analyzeItemImpact(post.content, item.name);

    await prisma.itemAnalysis.create({
      data: {
        postId: post.id,
        itemId: item.id,
        relevantTextSnippet: result.relevant_text_snippet,
        expectedPriceChange: toPriceChangeEnum(result.expected_price_change),
      },
    });

    if (INCLUDED_CHANGE_TYPES.includes(result.expected_price_change)) {
      const emoji = {
        'Price increase': '🟢',
        'Price decrease': '🔴',
        'No change': '🟡',
      }[result.expected_price_change];
      const msg = [
        `<b>${item.name}</b>`,
        ``,
        `“${result.relevant_text_snippet}”`,
        ``,
        `${emoji} ${result.expected_price_change}`,
      ].join('\n');

      await sendTelegramMessage(msg);
      console.log(`✉️ Sent analysis for “${item.name}” in post ${post.id}.`);
    } else {
      console.log(
        `ℹ️ Skipped Telegram for “${item.name}” – change type not included.`
      );
    }
  } catch (err) {
    const errMsg = `⚠️ Analysis failed for item “${item.name}” (ID: ${item.id}):\n${err.message}`;
    console.error(errMsg);
    await sendTelegramMessage(errMsg);
  }
}

async function processOnePost(post) {
  try {
    console.log(`🔍 Processing post ${post.id}: "${post.title}"`);

    const significantItems = await getEconomicallySignificantItems(prisma);
    const matchedItems = findMatches(post.content, significantItems);
    console.log(
      `➡️ Found ${matchedItems.length} matched item(s) in post ${post.id}.`
    );

    if (matchedItems.length === 0) return;

    // 'item' is now the full object from the matcher, so we use it directly.
    const analysisPromises = matchedItems.map((item) =>
      analyzeOneItem(post, item)
    );
    await Promise.all(analysisPromises);
  } catch (err) {
    console.error(`❌ Error processing post ${post.id}:`, err);
    await sendTelegramMessage(
      `⚠️ Failed to process post ID ${post.id}:\n${err.message}`
    );
  }
}

async function pollAndProcess() {
  console.log('--- Polling for unprocessed posts ---');
  try {
    const postsToProcess = await prisma.post.findMany({
      where: { isAnalyzed: false },
    });

    if (postsToProcess.length === 0) {
      console.log('No new posts to process.');
      return;
    }

    console.log(`🔔 Found ${postsToProcess.length} new post(s) to analyze.`);
    for (const post of postsToProcess) {
      await processOnePost(post);
      await prisma.post.update({
        where: { id: post.id },
        data: { isAnalyzed: true },
      });
      console.log(`✅ Finished processing post ${post.id}.`);
    }
  } catch (err) {
    console.error('❌ Error in pollAndProcess loop:', err);
  }
}

// --- Main Post Pipeline ---
let pipelineRunning = false;

async function runPostPipeline() {
  if (pipelineRunning) {
    console.log('--- Pipeline already running, skipping ---');
    return;
  }
  pipelineRunning = true;
  console.log('--- Running Post Pipeline ---');
  try {
    await syncNewPosts();
    await pollAndProcess();
  } catch (err) {
    console.error('❌ Error in Post Pipeline:', err);
  } finally {
    pipelineRunning = false;
  }
}

// --- Main Application Entrypoint ---
(async () => {
  console.log('Application starting...');

  // 1. Set up the infrequent data sync scheduler (checks every minute)
  await runDataSyncScheduler();
  setInterval(runDataSyncScheduler, 60 * 1000);
  console.log(`⏰ Data sync scheduler running, will check every minute.`);

  // 2. Set up the frequent post pipeline (checks for new posts and analyzes)
  await runPostPipeline();
  setInterval(runPostPipeline, RATE_LIMIT_SECONDS * 1000);
  console.log(`⏰ Post pipeline running every ${RATE_LIMIT_SECONDS} seconds.`);
})();
