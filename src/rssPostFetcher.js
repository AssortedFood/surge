// src/rssPostFetcher.js
import 'dotenv/config'; // Load environment variables from .env
import fetch from "node-fetch";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { load } from "cheerio";

// Determine __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Paths
const dataDir       = resolve(__dirname, "../data");
const seenPostsFile = join(dataDir, "seenPosts.json");
const postsDir      = join(dataDir, "posts");

export async function fetchAndSavePost(postId) {
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

  const post = seenPosts.find((p) => p.id === postId);
  if (!post) {
    throw new Error(`No post with id ${postId} found in seenPosts.json`);
  }
  const { title, link } = post;

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

  // 6. Build the output filename: "{id}.txt"
  const filename  = `${postId}.txt`;

  await fs.mkdir(postsDir, { recursive: true });

  // 8. Write markdown to data/posts/{filename}
  const outPath = join(postsDir, filename);
  await fs.writeFile(outPath, markdownContent, "utf-8");

  return outPath;
}

// If run directly via CLI
if (process.argv.length >= 3 && process.argv[1].endsWith("rssPostFetcher.js")) {
  const idArg = parseInt(process.argv[2], 10);
  if (isNaN(idArg)) {
    console.error("Usage: node src/rssPostFetcher.js <postId>");
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
