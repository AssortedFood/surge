// src/syncPosts.js
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import puppeteer from 'puppeteer';

const prisma = new PrismaClient();

const RSS_PAGE_URL = process.env.RSS_PAGE_URL;
const PUPPETEER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';

// NEW: Read the interval from .env and provide a default of 60 seconds
const RSS_CHECK_INTERVAL_SECONDS =
  parseInt(process.env.RSS_CHECK_INTERVAL_SECONDS, 10) || 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchRssXml() {
  const res = await fetch(RSS_PAGE_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch RSS page: HTTP ${res.status}`);
  }
  return res.text();
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
    browser = await puppeteer.launch({ headless: true });
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

async function syncNewPosts() {
  if (!RSS_PAGE_URL) {
    console.error(
      '[POST SYNC] Error: RSS_PAGE_URL is not defined in the .env file.'
    );
    return;
  }

  console.log('[POST SYNC] Checking for new posts...');

  try {
    const seenPosts = await prisma.post.findMany({ select: { link: true } });
    const seenLinks = new Set(seenPosts.map((p) => p.link));

    const xml = await fetchRssXml();
    const allPostsFromFeed = scrapeTitlesAndUrls(xml);
    const newPosts = allPostsFromFeed.filter((p) => !seenLinks.has(p.link));

    if (newPosts.length === 0) {
      console.log('[POST SYNC] No new posts found.');
      return;
    }

    newPosts.reverse();
    console.log(
      `[POST SYNC] Found ${newPosts.length} new post(s). Fetching content in chronological order...`
    );

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
        console.log(
          `[POST SYNC] Successfully saved post ID ${nextId}: "${title}"`
        );

        nextId++;

        if (i < newPosts.length - 1) {
          // MODIFIED: Use the configured interval for the log message
          console.log(
            `[POST SYNC] Waiting ${RSS_CHECK_INTERVAL_SECONDS} seconds to respect rate limit...`
          );
          // MODIFIED: Use the configured interval (converted to milliseconds) for the delay
          await sleep(RSS_CHECK_INTERVAL_SECONDS * 1000);
        }
      } catch (err) {
        console.error(
          `[POST SYNC] Failed to process post "${post.title}". Error:`,
          err
        );
      }
    }

    console.log('[POST SYNC] Synchronization complete.');
  } catch (err) {
    console.error('[POST SYNC] A critical error occurred:', err);
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
