import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment variable before importing the module
vi.stubEnv('OPENAI_MODEL', 'gpt-4');

// Mock fetchStructuredResponse before importing semanticItemAnalysis
vi.mock('./fetchStructuredResponse.js', () => ({
  fetchStructuredResponse: vi.fn(),
}));

// Import after mocking
const { fetchStructuredResponse } =
  await import('./fetchStructuredResponse.js');
const { analyzeItemImpact } = await import('./semanticItemAnalysis.js');

describe('analyzeItemImpact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful analysis', () => {
    it('should return analysis with parsed response', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              parsed: {
                relevant_text_snippet: 'Dragon platebody received a buff',
                expected_price_change: 'Price increase',
              },
            },
          },
        ],
      };

      fetchStructuredResponse.mockResolvedValue(mockResponse);

      const result = await analyzeItemImpact(
        'Dragon platebody is now stronger',
        'Dragon platebody'
      );

      expect(result.relevant_text_snippet).toBe(
        'Dragon platebody received a buff'
      );
      expect(result.expected_price_change).toBe('Price increase');
    });

    it('should handle response with content instead of parsed', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                relevant_text_snippet: 'Item was nerfed',
                expected_price_change: 'Price decrease',
              }),
            },
          },
        ],
      };

      fetchStructuredResponse.mockResolvedValue(mockResponse);

      const result = await analyzeItemImpact('Item was nerfed', 'Test item');

      expect(result.relevant_text_snippet).toBe('Item was nerfed');
      expect(result.expected_price_change).toBe('Price decrease');
    });
  });

  describe('price change types', () => {
    it.each([
      ['Price increase', 'Price increase'],
      ['Price decrease', 'Price decrease'],
      ['No change', 'No change'],
    ])('should handle %s correctly', async (priceChange, expected) => {
      const mockResponse = {
        choices: [
          {
            message: {
              parsed: {
                relevant_text_snippet: 'Some snippet',
                expected_price_change: priceChange,
              },
            },
          },
        ],
      };

      fetchStructuredResponse.mockResolvedValue(mockResponse);

      const result = await analyzeItemImpact('Test content', 'Test item');

      expect(result.expected_price_change).toBe(expected);
    });
  });

  describe('error handling', () => {
    it('should throw when response has no choices', async () => {
      const mockResponse = { choices: [] };

      fetchStructuredResponse.mockResolvedValue(mockResponse);

      await expect(
        analyzeItemImpact('Test content', 'Test item')
      ).rejects.toThrow();
    });

    it('should throw when message is undefined', async () => {
      const mockResponse = {
        choices: [{ message: undefined }],
      };

      fetchStructuredResponse.mockResolvedValue(mockResponse);

      await expect(
        analyzeItemImpact('Test content', 'Test item')
      ).rejects.toThrow('No choices[0].message found');
    });

    it('should throw when neither parsed nor content exists', async () => {
      const mockResponse = {
        choices: [{ message: {} }],
      };

      fetchStructuredResponse.mockResolvedValue(mockResponse);

      await expect(
        analyzeItemImpact('Test content', 'Test item')
      ).rejects.toThrow('Neither message.parsed nor message.content');
    });

    it('should throw when fetchStructuredResponse fails', async () => {
      fetchStructuredResponse.mockRejectedValue(new Error('API error'));

      await expect(
        analyzeItemImpact('Test content', 'Test item')
      ).rejects.toThrow('API error');
    });
  });
});
