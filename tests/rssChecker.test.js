// tests/rssChecker.test.js
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Mock node-fetch
import fetch from 'node-fetch';
vi.mock('node-fetch', () => ({ default: vi.fn() }));

// Import the module under test
let getNewRssPosts;

// Paths
const __filename    = fileURLToPath(import.meta.url);
const __dirname     = path.dirname(__filename);
const projectDir    = path.resolve(__dirname, '..');
const dataDir       = path.join(projectDir, 'data');
const seenPostsFile = path.join(dataDir, 'seenPosts.json');

let originalSeenPostsContent = null;
let hadOriginalSeenPosts = false;

beforeAll(async () => {
  // Backup existing data/seenPosts.json if it exists
  try {
    const contents = await fs.readFile(seenPostsFile, 'utf-8');
    originalSeenPostsContent = contents;
    hadOriginalSeenPosts = true;
  } catch {
    hadOriginalSeenPosts = false;
  }
  // Import the function under test
  getNewRssPosts = (await import('../src/rssChecker.js')).getNewRssPosts;
});

afterAll(async () => {
  // Restore or remove seenPosts.json
  if (hadOriginalSeenPosts) {
    await fs.writeFile(seenPostsFile, originalSeenPostsContent, 'utf-8');
  } else {
    try {
      await fs.unlink(seenPostsFile);
    } catch {}
  }
});

describe('rssChecker getNewRssPosts', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Ensure we start with a clean state for this file
    if (hadOriginalSeenPosts) {
      // Restore the original content before each test
      await fs.writeFile(seenPostsFile, originalSeenPostsContent, 'utf-8');
    } else {
      // Remove any leftover file
      try {
        await fs.unlink(seenPostsFile);
      } catch {}
    }
  });

  afterEach(async () => {
    // After each test, ensure that seenPosts.json is either restored or removed
    if (hadOriginalSeenPosts) {
      await fs.writeFile(seenPostsFile, originalSeenPostsContent, 'utf-8');
    } else {
      try {
        await fs.unlink(seenPostsFile);
      } catch {}
    }
  });

  /**
   * Helper to build an RSS XML string with items in newest-first order.
   */
  function buildRssXml(newestFirstItems) {
    const itemStrings = newestFirstItems.map(
      ({ title, link }) => `
        <item>
          <title>${title}</title>
          <link>${link}</link>
        </item>`
    ).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1" version="2.0"><channel>${itemStrings}</channel></rss>`;
  }

  it('returns two new posts (oldest-first IDs) when no seenPosts.json exists', async () => {
    // Ensure no pre-existing file
    try {
      await fs.unlink(seenPostsFile);
    } catch {}

    // Arrange: RSS with two items, newest-first
    const itemsNewestFirst = [
      { title: 'Second Post', link: 'https://example.com/2' },
      { title: 'First Post',  link: 'https://example.com/1' }
    ];
    const rssXml = buildRssXml(itemsNewestFirst);

    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => rssXml
    });

    // Act
    const newPosts = await getNewRssPosts();

    // Assert: reversed internally so "First Post" → id=1, "Second Post" → id=2
    expect(newPosts).toHaveLength(2);
    expect(newPosts[0]).toEqual({
      id: 1,
      title: 'First Post',
      link: 'https://example.com/1'
    });
    expect(newPosts[1]).toEqual({
      id: 2,
      title: 'Second Post',
      link: 'https://example.com/2'
    });

    // Verify file content
    const stored = JSON.parse(await fs.readFile(seenPostsFile, 'utf-8'));
    expect(stored).toEqual([
      { id: 1, title: 'First Post',  link: 'https://example.com/1' },
      { id: 2, title: 'Second Post', link: 'https://example.com/2' }
    ]);
  });

  it('returns only the newly added post and appends to seenPosts.json when file exists', async () => {
    // Arrange: pre-populate seenPosts.json
    const existing = [{ id: 1, title: 'Alpha', link: 'https://site/alpha' }];
    await fs.writeFile(seenPostsFile, JSON.stringify(existing, null, 2), 'utf-8');

    const itemsNewestFirst = [
      { title: 'Beta',  link: 'https://site/beta' },
      { title: 'Alpha', link: 'https://site/alpha' }
    ];
    const rssXml = buildRssXml(itemsNewestFirst);

    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => rssXml
    });

    // Act
    const newPosts = await getNewRssPosts();

    // Assert: only "Beta" is new
    expect(newPosts).toHaveLength(1);
    expect(newPosts[0]).toEqual({
      id: 2,
      title: 'Beta',
      link: 'https://site/beta'
    });

    // Verify file
    const stored = JSON.parse(await fs.readFile(seenPostsFile, 'utf-8'));
    expect(stored).toEqual([
      { id: 1, title: 'Alpha', link: 'https://site/alpha' },
      { id: 2, title: 'Beta',  link: 'https://site/beta' }
    ]);
  });

  it('returns empty array and leaves file unchanged when no new posts', async () => {
    // Arrange: write existing file with two entries
    const existing = [
      { id: 1, title: 'One', link: 'https://a/one' },
      { id: 2, title: 'Two', link: 'https://a/two' }
    ];
    await fs.writeFile(seenPostsFile, JSON.stringify(existing, null, 2), 'utf-8');

    const itemsNewestFirst = [
      { title: 'Two', link: 'https://a/two' },
      { title: 'One', link: 'https://a/one' }
    ];
    const rssXml = buildRssXml(itemsNewestFirst);

    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => rssXml
    });

    // Act
    const newPosts = await getNewRssPosts();

    // Assert: no new posts
    expect(newPosts).toEqual([]);

    // File remains unchanged
    const stored = JSON.parse(await fs.readFile(seenPostsFile, 'utf-8'));
    expect(stored).toEqual(existing);
  });
});
