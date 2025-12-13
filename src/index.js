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
import logger from './utils/logger.js';
import loadConfig from './utils/config.js';

// Validate and load configuration at startup
const config = loadConfig();

const prisma = new PrismaClient();

// --- Configuration from validated config ---
const DATA_SYNC_INTERVAL_MINUTES = config.dataSyncIntervalMinutes;
const RATE_LIMIT_SECONDS = config.rateLimitSeconds;
const INCLUDED_CHANGE_TYPES = config.includedChangeTypes;

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
  logger.debug('Scheduler checking for due data sync');
  if (await shouldRunDataSync()) {
    logger.info('Triggering item & price data sync', {
      intervalMinutes: DATA_SYNC_INTERVAL_MINUTES,
    });
    try {
      await syncItemsAndPrices();
      await updateLastDataSync();
      logger.info('Item & price data sync finished');
    } catch (err) {
      logger.error('Error during item & price data sync', {
        error: err.message,
      });
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
  logger.info('Starting item analysis', {
    itemName: item.name,
    itemId: item.id,
    postId: post.id,
  });
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
        `"${result.relevant_text_snippet}"`,
        ``,
        `${emoji} ${result.expected_price_change}`,
      ].join('\n');

      await sendTelegramMessage(msg);
      logger.info('Sent Telegram alert', {
        itemName: item.name,
        postId: post.id,
        change: result.expected_price_change,
      });
    } else {
      logger.debug('Skipped Telegram alert - change type not included', {
        itemName: item.name,
        change: result.expected_price_change,
      });
    }

    return { success: true, itemName: item.name };
  } catch (err) {
    const errMsg = `Analysis failed for item "${item.name}" (ID: ${item.id}):\n${err.message}`;
    logger.error('Item analysis failed', {
      itemName: item.name,
      itemId: item.id,
      error: err.message,
    });
    await sendTelegramMessage(errMsg);

    return { success: false, itemName: item.name, error: err.message };
  }
}

export async function processOnePost(post) {
  try {
    logger.info('Processing post', { postId: post.id, title: post.title });

    const significantItems = await getEconomicallySignificantItems(prisma);
    const matchedItems = findMatches(post.content, significantItems);
    logger.info('Found matched items', {
      postId: post.id,
      matchCount: matchedItems.length,
    });

    if (matchedItems.length === 0) {
      return { success: true, itemsProcessed: 0, itemsFailed: 0 };
    }

    // 'item' is now the full object from the matcher, so we use it directly.
    const analysisPromises = matchedItems.map((item) =>
      analyzeOneItem(post, item)
    );
    const results = await Promise.all(analysisPromises);

    const successes = results.filter((r) => r.success).length;
    const failures = results.filter((r) => !r.success).length;

    logger.info('Post analysis complete', {
      postId: post.id,
      itemsProcessed: successes,
      itemsFailed: failures,
    });

    return {
      success: failures === 0,
      itemsProcessed: successes,
      itemsFailed: failures,
    };
  } catch (err) {
    logger.error('Error processing post', {
      postId: post.id,
      error: err.message,
    });
    await sendTelegramMessage(
      `Failed to process post ID ${post.id}:\n${err.message}`
    );
    return {
      success: false,
      itemsProcessed: 0,
      itemsFailed: 0,
      error: err.message,
    };
  }
}

async function pollAndProcess() {
  logger.debug('Polling for unprocessed posts');
  try {
    const postsToProcess = await prisma.post.findMany({
      where: { isAnalyzed: false },
    });

    if (postsToProcess.length === 0) {
      logger.debug('No new posts to process');
      return;
    }

    logger.info('Found posts to analyze', { count: postsToProcess.length });
    for (const post of postsToProcess) {
      const result = await processOnePost(post);

      if (result.success) {
        await prisma.post.update({
          where: { id: post.id },
          data: { isAnalyzed: true },
        });
        logger.info('Finished processing post', { postId: post.id });
      } else {
        logger.warn('Post processing had failures - will retry on next run', {
          postId: post.id,
          itemsFailed: result.itemsFailed,
        });
      }
    }
  } catch (err) {
    logger.error('Error in pollAndProcess loop', { error: err.message });
  }
}

// --- Main Post Pipeline ---
let pipelineRunning = false;

async function runPostPipeline() {
  if (pipelineRunning) {
    logger.debug('Pipeline already running, skipping');
    return;
  }
  pipelineRunning = true;
  logger.debug('Running post pipeline');
  try {
    // Sync new posts and process each one immediately after scraping
    await syncNewPosts(processOnePost);
    // Retry any posts that failed processing on previous runs
    await pollAndProcess();
  } catch (err) {
    logger.error('Error in post pipeline', { error: err.message });
  } finally {
    pipelineRunning = false;
  }
}

// --- Main Application Entrypoint ---
(async () => {
  logger.info('Application starting');

  // 1. Set up the infrequent data sync scheduler (checks every minute)
  await runDataSyncScheduler();
  setInterval(runDataSyncScheduler, 60 * 1000);
  logger.info('Data sync scheduler started', { checkIntervalSeconds: 60 });

  // 2. Set up the frequent post pipeline (checks for new posts and analyzes)
  await runPostPipeline();
  setInterval(runPostPipeline, RATE_LIMIT_SECONDS * 1000);
  logger.info('Post pipeline started', { intervalSeconds: RATE_LIMIT_SECONDS });
})();
