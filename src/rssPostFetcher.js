// src/rssPostFetcher.js
import fetch from "node-fetch";
import fs from "fs/promises";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { load } from "cheerio";

// Determine __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Load config.json
const rawConfig = readFileSync(resolve(__dirname, "../config.json"), "utf-8");
const config    = JSON.parse(rawConfig);

// Paths
const dataDir       = resolve(__dirname, "../data");
const seenPostsFile = join(dataDir, "seenPosts.json");
const postsDir      = join(dataDir, "posts");

/**
 * Sanitize a string for use as a filesystem name:
 * - Replace slashes, colons, and other problematic chars with dashes
 * - Trim whitespace
 */
function sanitizeFilename(name) {
  return name
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();
}

/**
 * Given a post ID, load seenPosts.json, find the matching entry
 * (with fields { id, title, link }), fetch the HTML at `link`,
 * extract the article content, and save it as Markdown under:
 *   data/posts/{id} - {sanitized_title}.txt
 *
 * If the ID is not found in seenPosts.json, throws an Error.
 * Returns the filepath of the written Markdown on success.
 *
 * @param {number} postId
 * @returns {Promise<string>}
 */
export async function fetchAndSavePost(postId) {
  // 1. Load seenPosts.json
  let seenPosts;
  try {
    const raw = await fs.readFile(seenPostsFile, "utf-8");
    seenPosts = JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`seenPosts.json not found at ${seenPostsFile}`);
    }
    throw err;
  }

  // 2. Find the post entry by ID
  const post = seenPosts.find((p) => p.id === postId);
  if (!post) {
    throw new Error(`No post with id ${postId} found in seenPosts.json`);
  }
  const { title, link } = post;

  // 3. Fetch the HTML content of the link
  let res;
  try {
    res = await fetch(link);
  } catch (err) {
    throw new Error(`Failed to fetch URL ${link}: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch URL ${link}: HTTP ${res.status}`);
  }
  const html = await res.text();

  // 4. Parse HTML and extract the article content
  //    We assume the main article content is inside a <div class="news-article-content">
  const $ = load(html);
  const container = $(".news-article-content");
  if (!container.length) {
    throw new Error(`Could not find .news-article-content on page ${link}`);
  }

  // 5. Convert the container's paragraphs to Markdown-like text.
  //    For each <p>, take its text and separate by two line breaks.
  const paragraphs = [];
  container.find("p").each((_, elem) => {
    const text = $(elem).text().trim();
    if (text) {
      paragraphs.push(text);
    }
  });
  const markdownContent = paragraphs.join("\n\n");

  // 6. Build the output filename: "{id} - {sanitized_title}.txt"
  const safeTitle = sanitizeFilename(title);
  const filename  = `${postId} - ${safeTitle}.txt`;

  // 7. Ensure postsDir exists
  await fs.mkdir(postsDir, { recursive: true });

  // 8. Write markdown to data/posts/{filename}
  const outPath = join(postsDir, filename);
  await fs.writeFile(outPath, markdownContent, "utf-8");

  return outPath;
}

// If run directly via `node src/rssPostFetcher.js <id>`, fetch that post once
if (process.argv.length >= 3 && process.argv[1].endsWith("rssPostFetcher.js")) {
  const idArg = parseInt(process.argv[2], 10);
  if (isNaN(idArg)) {
    console.error("Usage: node rssPostFetcher.js <postId>");
    process.exit(1);
  }
  fetchAndSavePost(idArg)
    .then((filepath) => {
      console.log(`Saved post ${idArg} to ${filepath}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
