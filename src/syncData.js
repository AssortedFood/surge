// src/syncData.js
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';

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
  console.log(
    `[SYNC] Starting ${PRICE_FETCH_INTERVAL} data synchronization...`
  );
  const snapshotTime = getSnapshotTime();
  console.log(`[SYNC] Using snapshot time: ${snapshotTime.toISOString()}`);

  try {
    const [mappingRes, pricesRes] = await Promise.all([
      fetch(MAPPING_API_URL, { headers: apiHeaders }),
      fetch(LATEST_API_URL, { headers: apiHeaders }),
    ]);

    if (!mappingRes.ok || !pricesRes.ok) {
      throw new Error('Failed to fetch data from one or more API endpoints.');
    }

    const mappingData = await mappingRes.json();
    const pricesData = (await pricesRes.json()).data;

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
    console.log(
      `[SYNC] Synchronization complete. Processed ${result.length} database operations.`
    );
  } catch (err) {
    if (err.code === 'P2002') {
      console.warn(
        `[SYNC] Warning: Some price snapshots already existed for this interval. This is normal if the script runs more than once per interval. Run completed.`
      );
    } else {
      console.error('[SYNC] An error occurred during synchronization:', err);
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
