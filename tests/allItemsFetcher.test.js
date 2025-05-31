// tests/allItemsFetcher.test.js
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Mock node-fetch
import fetch from 'node-fetch';
vi.mock('node-fetch', () => ({ default: vi.fn() }));

// Determine file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const projectDir = path.resolve(__dirname, '..');
const dataDir    = path.join(projectDir, 'data');
const outputFile = path.join(dataDir, 'all_items.json');

let fetchAndSaveAllItems;
let userAgent;

beforeAll(async () => {
  // Read userAgent from config.json
  const config = JSON.parse(await fs.readFile(path.join(projectDir, 'config.json'), 'utf-8'));
  userAgent = config.userAgent;

  // Backup existing data/all_items.json if it exists
  try {
    await fs.readFile(outputFile, 'utf-8');
    hadOriginalAllItems = true;
  } catch {
    hadOriginalAllItems = false;
  }

  // Import the function under test
  fetchAndSaveAllItems = (await import('../src/allItemsFetcher.js')).fetchAndSaveAllItems;
});

let hadOriginalAllItems = false;
let originalAllItemsContent = null;

beforeAll(async () => {
  if (hadOriginalAllItems) {
    originalAllItemsContent = await fs.readFile(outputFile, 'utf-8');
  }
});

afterAll(async () => {
  // Restore original data/all_items.json
  if (hadOriginalAllItems) {
    await fs.writeFile(outputFile, originalAllItemsContent, 'utf-8');
  } else {
    try {
      await fs.unlink(outputFile);
    } catch {}
  }
});

describe('allItemsFetcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // After each test, ensure no stray file remains except the backed-up content
    if (hadOriginalAllItems) {
      const current = await fs.readFile(outputFile, 'utf-8');
      if (current !== originalAllItemsContent) {
        await fs.writeFile(outputFile, originalAllItemsContent, 'utf-8');
      }
    } else {
      try {
        await fs.unlink(outputFile);
      } catch {}
    }
  });

  it('writes JSON file when fetch returns ok', async () => {
    const fakeData = [{ id: 1, name: 'TestItem' }];
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => fakeData
    });

    await fetchAndSaveAllItems();

    const contents = await fs.readFile(outputFile, 'utf-8');
    expect(JSON.parse(contents)).toEqual(fakeData);
  });

  it('throws error and does not overwrite existing file when HTTP response is not ok', async () => {
    if (!hadOriginalAllItems) {
      await fs.writeFile(outputFile, JSON.stringify([{ id: 99, name: 'KeepMe' }]), 'utf-8');
    }
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({})
    });

    await expect(fetchAndSaveAllItems()).rejects.toThrow('HTTP 500: Internal Server Error');

    const contents = await fs.readFile(outputFile, 'utf-8');
    if (hadOriginalAllItems) {
      expect(contents).toBe(originalAllItemsContent);
    } else {
      expect(JSON.parse(contents)).toEqual([{ id: 99, name: 'KeepMe' }]);
    }
  });

  it('calls fetch with correct URL and User-Agent header', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => []
    });

    await fetchAndSaveAllItems();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetch.mock.calls[0];
    const config = JSON.parse(await fs.readFile(path.join(projectDir, 'config.json'), 'utf-8'));
    expect(calledUrl).toBe(config.itemListUrl);
    expect(calledOptions.headers).toMatchObject({
      'User-Agent': userAgent
    });
  });
});
