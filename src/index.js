// src/index.js
import 'dotenv/config';
import { PrismaClient, PriceChange } from '@prisma/client';

// Import all necessary functions from other modules
import { cleanPostContent } from './contentCleaner.js';
import { extractItemCandidates } from './itemExtractor.js';
import { validateItemCandidates } from './itemValidator.js';
import { predictPriceChange } from './pricePredictor.js';
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

async function analyzeAndSaveItem(post, validatedItem, prediction) {
  try {
    await prisma.itemAnalysis.create({
      data: {
        postId: post.id,
        itemId: validatedItem.itemId,
        relevantTextSnippet: validatedItem.snippet,
        expectedPriceChange: toPriceChangeEnum(prediction.direction),
      },
    });

    if (INCLUDED_CHANGE_TYPES.includes(prediction.direction)) {
      const emoji = {
        'Price increase': '🟢',
        'Price decrease': '🔴',
        'No change': '🟡',
      }[prediction.direction];
      const msg = [
        `<b>${validatedItem.itemName}</b>`,
        ``,
        `"${validatedItem.snippet}"`,
        ``,
        `${emoji} ${prediction.direction}`,
        `<i>${prediction.reasoning}</i>`,
      ].join('\n');

      await sendTelegramMessage(msg);
      logger.info('Sent Telegram alert', {
        itemName: validatedItem.itemName,
        postId: post.id,
        change: prediction.direction,
      });
    } else {
      logger.debug('Skipped Telegram alert - change type not included', {
        itemName: validatedItem.itemName,
        change: prediction.direction,
      });
    }

    return { success: true, itemName: validatedItem.itemName };
  } catch (err) {
    const errMsg = `Analysis failed for item "${validatedItem.itemName}" (ID: ${validatedItem.itemId}):\n${err.message}`;
    logger.error('Item analysis failed', {
      itemName: validatedItem.itemName,
      itemId: validatedItem.itemId,
      error: err.message,
    });
    await sendTelegramMessage(errMsg);

    return {
      success: false,
      itemName: validatedItem.itemName,
      error: err.message,
    };
  }
}

export async function processOnePost(post) {
  try {
    logger.info('Processing post', { postId: post.id, title: post.title });

    // 1. Clean content to reduce noise
    const cleanedContent = cleanPostContent(post.content);
    logger.debug('Content cleaned', {
      postId: post.id,
      originalLength: post.content.length,
      cleanedLength: cleanedContent.length,
    });

    // 2. Extract item candidates via LLM
    const candidates = await extractItemCandidates(post.title, cleanedContent);
    logger.info('Extracted item candidates', {
      postId: post.id,
      candidateCount: candidates.length,
    });

    if (candidates.length === 0) {
      return { success: true, itemsProcessed: 0, itemsFailed: 0 };
    }

    // 3. Validate candidates against item database
    const allItems = await prisma.item.findMany({
      select: { id: true, name: true },
    });
    const validated = validateItemCandidates(candidates, allItems);
    logger.info('Validated item candidates', {
      postId: post.id,
      validatedCount: validated.length,
    });

    if (validated.length === 0) {
      return { success: true, itemsProcessed: 0, itemsFailed: 0 };
    }

    // 4. Filter by economic significance
    const significantItems = await getEconomicallySignificantItems(prisma);
    const significantIds = new Set(significantItems.map((i) => i.id));
    const filtered = validated.filter((item) =>
      significantIds.has(item.itemId)
    );
    logger.info('Filtered to economically significant items', {
      postId: post.id,
      filteredCount: filtered.length,
    });

    if (filtered.length === 0) {
      return { success: true, itemsProcessed: 0, itemsFailed: 0 };
    }

    // 5. Predict price direction for each item (1:1 calls) and save
    const results = [];
    for (const item of filtered) {
      try {
        const prediction = await predictPriceChange(
          item.itemName,
          item.snippet
        );
        const result = await analyzeAndSaveItem(post, item, prediction);
        results.push(result);
      } catch (err) {
        logger.error('Price prediction failed for item', {
          itemName: item.itemName,
          error: err.message,
        });
        results.push({
          success: false,
          itemName: item.itemName,
          error: err.message,
        });
      }
    }

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
