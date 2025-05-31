// src/rssChecker.js
import 'dotenv/config'; // Load environment variables from .env
import fetch from "node-fetch";
import { load } from "cheerio";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Use environment variable for the RSS feed URL
const rssPageUrl = process.env.RSS_PAGE_URL;

if (!rssPageUrl) {
  console.error("[rssChecker] Error: RSS_PAGE_URL is not defined in the .env file.");
  process.exit(1);
}

const dataDir       = resolve(__dirname, "../data");
const seenPostsFile = resolve(dataDir, "seenPosts.json");

/**
 * Fetches the RSS/XML from the configured URL.
 * @returns {Promise<string>} XML string
 */
async function fetchRssXml() {
  const res = await fetch(rssPageUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch RSS page: HTTP ${res.status}`);
  }
  return await res.text();
}

/**
 * Parses RSS/XML content and returns an array of { title, link } objects.
 * @param {string} xml
 * @returns {{ title: string, link: string }[]}
 */
function scrapeTitlesAndUrls(xml) {
  const $ = load(xml, { xmlMode: true });
  const items = [];
  $("item").each((_, elem) => {
    const title = $(elem).find("title").text().trim();
    const link  = $(elem).find("link").text().trim();
    if (title && link) {
      items.push({ title, link });
    }
  });
  return items;
}

/**
 * Loads the seenPosts.json file, returning an array of stored posts,
 * each with shape { id, title, link }. If the file doesn't exist, returns [].
 */
async function loadSeenPosts() {
  try {
    const raw = await fs.readFile(seenPostsFile, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/**
 * Saves the given array of posts (each { id, title, link }) to seenPosts.json.
 * Ensures data directory exists.
 */
async function saveSeenPosts(allPosts) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(seenPostsFile, JSON.stringify(allPosts, null, 2), "utf-8");
}

/**
 * Fetches the RSS feed, scrapes items, compares to seenPosts.json,
 * updates seenPosts.json with any newly discovered posts (assigning incrementing IDs
 * such that older posts get lower IDs), and returns an array of new posts
 * in the form { id, title, link }.
 *
 * @returns {Promise<{ id: number, title: string, link: string }[]>}
 */
export async function getNewRssPosts() {
  const seenPosts = await loadSeenPosts();
  const seenMap = new Map(seenPosts.map(post => [post.title, post.id]));
  let nextId = seenPosts.length > 0
    ? Math.max(...seenPosts.map(p => p.id)) + 1
    : 1;

  const xml     = await fetchRssXml();
  const scraped = scrapeTitlesAndUrls(xml);
  const rawNewPosts = scraped.filter(post => !seenMap.has(post.title));
  rawNewPosts.reverse();

  const newPostsList = [];
  for (const { title, link } of rawNewPosts) {
    const newPost = { id: nextId++, title, link };
    seenPosts.push(newPost);
    seenMap.set(title, newPost.id);
    newPostsList.push(newPost);
  }

  if (newPostsList.length > 0) {
    await saveSeenPosts(seenPosts);
  }

  return newPostsList;
}

/**
 * If this file is run directly with Node, call getNewRssPosts once and exit.
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      const newPosts = await getNewRssPosts();
      console.log(newPosts);
    } catch (err) {
      console.error("[rssChecker] Error:", err);
      process.exit(1);
    }
  })();
}
