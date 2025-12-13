// src/syncPosts.js
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import puppeteer from 'puppeteer';
import logger from './utils/logger.js';
import { withRetry } from './utils/retry.js';

const prisma = new PrismaClient();

const RSS_PAGE_URL = process.env.RSS_PAGE_URL;
const PUPPETEER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';

// Shared rate limit for RSS feed and article pages (same domain)
const RATE_LIMIT_SECONDS = parseInt(process.env.RATE_LIMIT_SECONDS, 10) || 60;

// Key for tracking last fetch time in database
const LAST_FETCH_KEY = 'lastFetchTimestamp';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function canFetch() {
  const lastFetch = await prisma.appState.findUnique({
    where: { key: LAST_FETCH_KEY },
  });
  if (!lastFetch) return true;

  const elapsed = Date.now() - new Date(lastFetch.value).getTime();
  const allowed = elapsed >= RATE_LIMIT_SECONDS * 1000;

  if (!allowed) {
    const remaining = Math.ceil((RATE_LIMIT_SECONDS * 1000 - elapsed) / 1000);
    logger.debug('Rate limit active', { remainingSeconds: remaining });
  }

  return allowed;
}

async function updateLastFetch() {
  const now = new Date().toISOString();
  await prisma.appState.upsert({
    where: { key: LAST_FETCH_KEY },
    update: { value: now },
    create: { key: LAST_FETCH_KEY, value: now },
  });
}

async function fetchRssXml() {
  return withRetry(
    async () => {
      const res = await fetch(RSS_PAGE_URL);
      if (!res.ok) {
        const error = new Error(`Failed to fetch RSS page: HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      return res.text();
    },
    { maxRetries: 3, operationName: 'Fetch RSS feed' }
  );
}

function scrapeTitlesAndUrls(xml) {
  const $ = load(xml, { xmlMode: true });
  const items = [];
  $('item').each((_, elem) => {
    const title = $(elem).find('title').text().trim();
    const link = $(elem).find('link').text().trim();
    if (title && link) {
      items.push({ title, link });
    }
  });
  return items;
}

async function fetchPostContent(link) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setUserAgent(PUPPETEER_USER_AGENT);
    await page.goto(link, { waitUntil: 'networkidle2' });

    await page.$$eval('details', (elements) => {
      elements.forEach((el) => {
        el.open = true;
      });
    });

    const articleText = await page.$eval('.news-article-content', (el) =>
      el.innerText.trim()
    );
    return articleText;
  } catch (err) {
    throw new Error(
      `Puppeteer failed to scrape content from ${link}: ${err.message}`
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function syncNewPosts() {
  if (!RSS_PAGE_URL) {
    logger.error('RSS_PAGE_URL is not defined in the .env file');
    return;
  }

  // Check rate limit before fetching RSS
  if (!(await canFetch())) {
    return;
  }

  logger.debug('Checking for new posts');

  try {
    const seenPosts = await prisma.post.findMany({ select: { link: true } });
    const seenLinks = new Set(seenPosts.map((p) => p.link));

    const xml = await fetchRssXml();
    await updateLastFetch();
    const allPostsFromFeed = scrapeTitlesAndUrls(xml);
    const newPosts = allPostsFromFeed.filter((p) => !seenLinks.has(p.link));

    if (newPosts.length === 0) {
      logger.debug('No new posts found');
      return;
    }

    newPosts.reverse();
    logger.info('Found new posts', { count: newPosts.length });

    const lastPost = await prisma.post.findFirst({
      orderBy: { id: 'desc' },
      select: { id: true },
    });

    let nextId = (lastPost?.id || 0) + 1;

    for (let i = 0; i < newPosts.length; i++) {
      const post = newPosts[i];
      try {
        const { title, link } = post;

        const content = await fetchPostContent(link);

        await prisma.post.create({
          data: {
            id: nextId,
            title,
            link,
            content,
          },
        });
        logger.info('Saved post', { postId: nextId, title });

        nextId++;

        if (i < newPosts.length - 1) {
          logger.debug('Waiting before fetching next article', {
            waitSeconds: RATE_LIMIT_SECONDS,
          });
          await sleep(RATE_LIMIT_SECONDS * 1000);
          await updateLastFetch();
        }
      } catch (err) {
        logger.error('Failed to process post', {
          title: post.title,
          error: err.message,
        });
      }
    }

    logger.info('Post synchronization complete');
  } catch (err) {
    logger.error('Critical error during post sync', { error: err.message });
  } finally {
    await prisma.$disconnect();
  }
}

if (
  import.meta.url.startsWith('file://') &&
  import.meta.url.endsWith(process.argv[1])
) {
  syncNewPosts();
}
