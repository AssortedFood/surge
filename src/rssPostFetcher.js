// src/rssPostFetcher.js
import 'dotenv/config';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import puppeteer from 'puppeteer';

// __dirname boilerplate for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Paths
const dataDir       = resolve(__dirname, '../data');
const seenPostsFile = join(dataDir, 'seenPosts.json');
const postsDir      = join(dataDir, 'posts');

/**
 * Fetches a post by its ID from seenPosts.json, loads it in headless Chrome,
 * opens all <details>, extracts the visible text under .news-article-content,
 * and writes it to data/posts/{postId}.txt.
 *
 * @param {number} postId
 * @returns {Promise<string>} outPath
 */
export async function fetchAndSavePost(postId) {
  // 1) Load seenPosts.json and find the post entry
  let seenPosts;
  try {
    const raw = await fs.readFile(seenPostsFile, 'utf-8');
    seenPosts = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`seenPosts.json not found at ${seenPostsFile}`);
    }
    throw err;
  }

  const post = seenPosts.find((p) => p.id === postId);
  if (!post) {
    throw new Error(`No post with id ${postId} found in seenPosts.json`);
  }
  const { link } = post;

  // 2) Launch Puppeteer, navigate, open <details>, extract innerText
  const browser = await puppeteer.launch({ headless: true });
  const page    = await browser.newPage();
  // optional: set a real UA to avoid headless detection
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/117.0.0.0 Safari/537.36'
  );
  await page.goto(link, { waitUntil: 'networkidle2' });

  // Open all <details> elements so hidden content becomes visible
  await page.$$eval('details', (all) => {
    all.forEach((d) => { d.open = true; });
  });

  // Grab the visible text from the article container
  let articleText;
  try {
    articleText = await page.$eval(
      '.news-article-content',
      (el) => el.innerText.trim()
    );
  } catch (err) {
    throw new Error(`Could not find .news-article-content on page ${link}`);
  }

  await browser.close();

  // 3) Write that text to data/posts/{postId}.txt
  await fs.mkdir(postsDir, { recursive: true });
  const filename = `${postId}.txt`;
  const outPath  = join(postsDir, filename);
  await fs.writeFile(outPath, articleText, 'utf-8');

  return outPath;
}

// CLI entrypoint: node src/rssPostFetcher.js <postId>
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1].endsWith('rssPostFetcher.js')
) {
  const idArg = parseInt(process.argv[2], 10);
  if (isNaN(idArg)) {
    console.error('Usage: node src/rssPostFetcher.js <postId>');
    process.exit(1);
  }
  fetchAndSavePost(idArg)
    .then((filepath) => {
      console.log(`✅ Saved post ${idArg} to ${filepath}`);
    })
    .catch((err) => {
      console.error('❌ Error in fetchAndSavePost:', err);
      process.exit(1);
    });
}