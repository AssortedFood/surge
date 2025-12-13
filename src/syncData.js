// src/syncData.js
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
import logger from './utils/logger.js';
import { withRetry } from './utils/retry.js';

const prisma = new PrismaClient();

const MAPPING_API_URL = process.env.MAPPING_API_URL;
const LATEST_API_URL = process.env.LATEST_API_URL;
const USER_AGENT = process.env.USER_AGENT || 'default-agent';
const apiHeaders = { 'User-Agent': USER_AGENT };

const PRICE_FETCH_INTERVAL = process.env.PRICE_FETCH_INTERVAL || 'daily';

function getSnapshotTime(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const hour = now.getUTCHours();

  switch (PRICE_FETCH_INTERVAL) {
    case 'hourly':
      return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
    case 'daily':
    default:
      return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  }
}

export async function syncItemsAndPrices() {
  logger.info('Starting data synchronization', {
    interval: PRICE_FETCH_INTERVAL,
  });
  const snapshotTime = getSnapshotTime();
  logger.debug('Using snapshot time', {
    snapshotTime: snapshotTime.toISOString(),
  });

  try {
    const fetchWithRetry = (url, name) =>
      withRetry(
        async () => {
          const res = await fetch(url, { headers: apiHeaders });
          if (!res.ok) {
            const error = new Error(`HTTP ${res.status} from ${name}`);
            error.status = res.status;
            throw error;
          }
          return res.json();
        },
        { maxRetries: 3, operationName: `Fetch ${name}` }
      );

    const [mappingData, pricesResponse] = await Promise.all([
      fetchWithRetry(MAPPING_API_URL, 'mapping API'),
      fetchWithRetry(LATEST_API_URL, 'prices API'),
    ]);

    const pricesData = pricesResponse.data;

    const priceMap = new Map(Object.entries(pricesData));
    const dbOperations = [];

    for (const item of mappingData) {
      if (!item.id || !item.name) continue;

      dbOperations.push(
        prisma.item.upsert({
          where: { id: item.id },
          update: {
            name: item.name,
            limit: item.limit ?? null,
            value: item.value ?? 0,
            highalch: item.highalch ?? null,
            lowalch: item.lowalch ?? null,
            members: item.members ?? false,
          },
          create: {
            id: item.id,
            name: item.name,
            examine: item.examine,
            members: item.members ?? false,
            limit: item.limit ?? null,
            value: item.value ?? 0,
            icon: item.icon,
            highalch: item.highalch ?? null,
            lowalch: item.lowalch ?? null,
          },
        })
      );

      const priceInfo = priceMap.get(String(item.id));
      if (priceInfo) {
        dbOperations.push(
          prisma.priceSnapshot.create({
            data: {
              itemId: item.id,
              highPrice: priceInfo.high,
              lowPrice: priceInfo.low,
              snapshotTime: snapshotTime,
            },
          })
        );
      }
    }

    const result = await prisma.$transaction(dbOperations);
    logger.info('Data synchronization complete', {
      operationCount: result.length,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      logger.warn(
        'Some price snapshots already existed for this interval - this is normal if running multiple times per interval'
      );
    } else {
      logger.error('Error during data synchronization', { error: err.message });
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (
  import.meta.url.startsWith('file://') &&
  import.meta.url.endsWith(process.argv[1])
) {
  syncItemsAndPrices();
}
