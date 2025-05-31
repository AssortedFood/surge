// src/rssChecker.js
import fetch from "node-fetch";
import { load } from "cheerio";
import fs from "fs/promises";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

// Determine __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Load config.json
const rawConfig = readFileSync(resolve(__dirname, "../config.json"), "utf-8");
const config    = JSON.parse(rawConfig);

const { rssPageUrl } = config;

// Path to the JSON file storing seen posts (with IDs)
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
  // 1. Load previously seen posts
  const seenPosts = await loadSeenPosts();
  // Build a quick lookup: title -> id
  const seenMap = new Map(seenPosts.map(post => [post.title, post.id]));
  // Determine next ID (max existing ID + 1), or 1 if none
  let nextId = seenPosts.length > 0
    ? Math.max(...seenPosts.map(p => p.id)) + 1
    : 1;

  // 2. Fetch and scrape current RSS
  const xml     = await fetchRssXml();
  const scraped = scrapeTitlesAndUrls(xml);

  // 3. Identify raw new posts (in scraped order: newest first)
  const rawNewPosts = scraped.filter(post => !seenMap.has(post.title));

  // 4. Reverse rawNewPosts so that the oldest among them (bottom-most) is first
  rawNewPosts.reverse();

  // 5. Assign IDs to each new post in that reversed order,
  //    then append to seenPosts and collect in newPostsList
  const newPostsList = [];
  for (const { title, link } of rawNewPosts) {
    const newPost = { id: nextId++, title, link };
    seenPosts.push(newPost);
    seenMap.set(title, newPost.id);
    newPostsList.push(newPost);
  }

  // 6. If any new posts were found, save updated seenPosts
  if (newPostsList.length > 0) {
    await saveSeenPosts(seenPosts);
  }

  return newPostsList; // may be []
}

/**
 * If this file is run directly with Node (e.g. `node src/rssChecker.js`),
 * call getNewRssPosts once and exit (no polling).
 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    try {
      const newPosts = await getNewRssPosts();
      // Optionally log or process newPosts here
      console.log(newPosts);
    } catch (err) {
      console.error("[rssChecker] Error:", err);
      process.exit(1);
    }
  })();
}
