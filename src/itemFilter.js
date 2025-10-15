// src/itemFilter.js
import 'dotenv/config';

// Read configuration from .env with sensible defaults
const MARGIN_THRESHOLD = parseInt(process.env.MARGIN_THRESHOLD, 10) || 1000000;
const PRICE_VARIANCE_PERCENT = parseFloat(process.env.PRICE_VARIANCE_PERCENT) || 0.05;

/**
 * Queries the database for all items and their latest prices, then filters them
 * based on margin and volatility thresholds.
 * @param {PrismaClient} prisma - The Prisma client instance.
 * @returns {Promise<Array<Item>>} A filtered array of economically significant items.
 */
export async function getEconomicallySignificantItems(prisma) {
  console.log('[FILTER] Fetching items and latest prices from database...');

  // 1. Fetch all items and include their MOST RECENT price snapshot
  const itemsWithPrices = await prisma.item.findMany({
    include: {
      prices: {
        orderBy: { snapshotTime: 'desc' },
        take: 1, // This is the key: only get the latest price for each item
      },
    },
  });

  console.log(`[FILTER] Found ${itemsWithPrices.length} total items. Applying filters...`);

  const significantItems = [];
  for (const item of itemsWithPrices) {
    // Skip items that have no price data or no buy limit
    if (!item.prices || item.prices.length === 0 || !item.limit) {
      continue;
    }

    const latestPrice = item.prices[0];
    const { highPrice, lowPrice } = latestPrice;
    const { limit } = item;

    // Skip items with no real trade data
    if (highPrice === 0 && lowPrice === 0) {
      continue;
    }

    const avgPrice = (highPrice + lowPrice) / 2;

    // --- Filter 1: Potential Profit (Margin Threshold) ---
    const potentialProfit = avgPrice * limit;
    if (potentialProfit < MARGIN_THRESHOLD) {
      continue;
    }

    // --- Filter 2: Volatility (Price Variance) ---
    const priceSpread = highPrice - lowPrice;
    const variance = avgPrice > 0 ? priceSpread / avgPrice : 0;
    if (variance < PRICE_VARIANCE_PERCENT) {
      continue;
    }

    // If the item passes all checks, add it to our list
    significantItems.push(item);
  }

  console.log(`[FILTER] Found ${significantItems.length} economically significant items.`);
  return significantItems;
}