// tests/allItemsFetcher.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

// Mock node-fetch
import fetch from 'node-fetch';
vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

// Import the function under test and config
import { fetchAndSaveAllItems } from '../src/allItemsFetcher.js';
import config from '../config.json' assert { type: 'json' };

const dataDir = path.resolve(__dirname, '../data');
const outputFile = path.join(dataDir, 'all_items.json');

describe('allItemsFetcher', () => {
  beforeEach(async () => {
    // Ensure no leftover file before each test
    try {
      await fs.unlink(outputFile);
    } catch {}
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up file after each test
    try {
      await fs.unlink(outputFile);
    } catch {}
  });

  it('writes JSON file when fetch returns ok', async () => {
    // Arrange: mock fetch to return ok response with JSON array
    const fakeData = [{ id: 1, name: 'TestItem' }];
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => fakeData
    });

    // Act
    await fetchAndSaveAllItems();

    // Assert: file exists and contains the expected JSON
    const contents = await fs.readFile(outputFile, 'utf-8');
    const parsed = JSON.parse(contents);
    expect(parsed).toEqual(fakeData);
  });

  it('throws error and does not write file when HTTP response is not ok', async () => {
    // Arrange: mock fetch to return non-ok response
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({})
    });

    // Act & Assert
    await expect(fetchAndSaveAllItems()).rejects.toThrow('HTTP 500: Internal Server Error');

    // Ensure file does not exist
    await expect(fs.access(outputFile)).rejects.toThrow();
  });

  it('calls fetch with correct URL and User-Agent header', async () => {
    // Arrange: mock fetch to return ok response
    const fakeData = [];
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => fakeData
    });

    // Act
    await fetchAndSaveAllItems();

    // Assert: fetch called once with correct arguments
    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetch.mock.calls[0];
    expect(calledUrl).toBe(config.itemListUrl);
    expect(calledOptions.headers).toMatchObject({
      'User-Agent': 'surge: item-price-analysis-bot - @oxidising on Discord'
    });
  });
});
