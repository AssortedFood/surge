/**
 * Significant Items Cache
 *
 * Queries economically significant items directly from the database.
 * Caches results in benchmark.db to avoid repeated queries.
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAIN_DB_PATH = join(__dirname, '../prisma/database.db');
const BENCHMARK_DB_PATH = join(__dirname, '../prisma/benchmark.db');

// Default threshold: 1M GP margin (value * limit)
const DEFAULT_THRESHOLD = 1_000_000;

// Prisma client for main database (where items live)
const mainPrisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${MAIN_DB_PATH}`,
    },
  },
});

// Prisma client for benchmark database (for caching)
const benchmarkPrisma = new PrismaClient({
  datasources: {
    db: {
      url: `file:${BENCHMARK_DB_PATH}`,
    },
  },
});

/**
 * Get the stored threshold from AppState
 */
async function getStoredThreshold() {
  const row = await benchmarkPrisma.appState.findUnique({
    where: { key: 'significant_items_threshold' },
  });
  return row ? parseInt(row.value, 10) : null;
}

/**
 * Store threshold in AppState
 */
async function setStoredThreshold(threshold) {
  await benchmarkPrisma.appState.upsert({
    where: { key: 'significant_items_threshold' },
    update: { value: threshold.toString() },
    create: { key: 'significant_items_threshold', value: threshold.toString() },
  });
}

/**
 * Recalculate and store significant items in the benchmark database
 */
async function recalculateSignificantItems(threshold) {
  // Query all items and filter in JS (Prisma doesn't support computed column filters)
  // This is acceptable since it runs once and is cached
  const allItems = await mainPrisma.item.findMany();
  const totalCount = allItems.length;

  // Filter by economic significance (value * limit >= threshold)
  const filtered = allItems.filter((item) => {
    const margin = (item.value || 0) * (item.limit || 0);
    return margin >= threshold;
  });

  // Clear existing cache
  await benchmarkPrisma.$executeRaw`DELETE FROM SignificantItem`;

  // Insert new items in batches
  const batchSize = 100;
  for (let i = 0; i < filtered.length; i += batchSize) {
    const batch = filtered.slice(i, i + batchSize);
    await Promise.all(
      batch.map(
        (item) =>
          benchmarkPrisma.$executeRaw`
          INSERT INTO SignificantItem (itemId, name, value, "limit", examine, members, icon)
          VALUES (${item.id}, ${item.name}, ${item.value || 0}, ${item.limit || 0}, ${item.examine || null}, ${item.members ? 1 : 0}, ${item.icon || null})
        `
      )
    );
  }

  // Store threshold
  await setStoredThreshold(threshold);

  console.log(
    `Recalculated significant items: ${filtered.length}/${totalCount} items (threshold: ${threshold.toLocaleString()} GP)`
  );

  return filtered;
}

/**
 * Get significant items from database
 * Caches in benchmark.db, recalculates if threshold changes
 *
 * @param {number} [threshold=1000000] - Economic significance threshold (value * limit)
 * @returns {Promise<{ items: Array, fromCache: boolean, threshold: number }>}
 */
export async function getSignificantItems(threshold = DEFAULT_THRESHOLD) {
  const storedThreshold = await getStoredThreshold();

  // Check if recalculation is needed
  if (storedThreshold !== threshold) {
    console.log(
      `Significant items cache invalidated (threshold changed: ${storedThreshold} -> ${threshold})`
    );
    const items = await recalculateSignificantItems(threshold);
    return { items, fromCache: false, threshold };
  }

  // Check if cache has items
  const [countResult] =
    await benchmarkPrisma.$queryRaw`SELECT COUNT(*) as count FROM SignificantItem`;
  const cacheCount = Number(countResult.count);

  if (cacheCount === 0) {
    console.log('Significant items cache empty, recalculating...');
    const items = await recalculateSignificantItems(threshold);
    return { items, fromCache: false, threshold };
  }

  // Load from cache
  const rows = await benchmarkPrisma.$queryRaw`
    SELECT itemId as id, name, value, "limit", examine, members, icon
    FROM SignificantItem
  `;

  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    value: row.value,
    limit: row.limit,
    examine: row.examine,
    members: row.members === 1 || row.members === true,
    icon: row.icon,
  }));

  return { items, fromCache: true, threshold };
}

/**
 * Force recalculation of significant items
 */
export async function forceRecalculate(threshold = DEFAULT_THRESHOLD) {
  const items = await recalculateSignificantItems(threshold);
  return { items, threshold };
}

/**
 * Disconnect Prisma clients (call on process exit)
 */
export async function disconnect() {
  await Promise.all([mainPrisma.$disconnect(), benchmarkPrisma.$disconnect()]);
}
