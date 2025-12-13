import { describe, it, expect } from 'vitest';
import { findMatches } from './itemMatcher.js';
import { sampleItems, samplePostContent } from '../tests/fixtures/items.js';

describe('findMatches', () => {
  describe('multi-word items', () => {
    it('should match items when all significant words appear in text', () => {
      // Use items with unique significant words to avoid conflict resolution
      const items = [
        { id: 1, name: 'Abyssal whip' },
        { id: 2, name: 'Bandos chestplate' },
        { id: 3, name: 'Twisted bow' },
      ];
      const text =
        'The abyssal whip and bandos chestplate are great. Twisted bow is rare.';
      const matches = findMatches(text, items);
      const matchedNames = matches.map((m) => m.name);

      expect(matchedNames).toContain('Abyssal whip');
      expect(matchedNames).toContain('Bandos chestplate');
      expect(matchedNames).toContain('Twisted bow');
      expect(matches.length).toBe(3);
    });

    it('should require all significant words to be present', () => {
      const items = [{ id: 1, name: 'Dragon platebody' }];
      // Only "dragon" is mentioned, not "platebody"
      const text = 'The dragon is fierce';
      const matches = findMatches(text, items);

      expect(matches.length).toBe(0);
    });
  });

  describe('single-word items', () => {
    it('should match single-word items with strict word boundaries', () => {
      const matches = findMatches(
        samplePostContent.singleWordMatch,
        sampleItems
      );
      const matchedNames = matches.map((m) => m.name);

      expect(matchedNames).toContain('Gold');
      expect(matchedNames).toContain('Rune');
    });

    it('should not match single-word items that are part of other words', () => {
      const text = 'The golden armor was runed with ancient symbols';
      const matches = findMatches(text, sampleItems);
      const matchedNames = matches.map((m) => m.name);

      // "golden" should not match "Gold", "runed" should not match "Rune"
      expect(matchedNames).not.toContain('Gold');
      expect(matchedNames).not.toContain('Rune');
    });
  });

  describe('conflict resolution', () => {
    it('should prioritize longer/more specific matches', () => {
      const items = [
        { id: 1, name: 'Dragon' },
        { id: 2, name: 'Dragon platebody' },
      ];
      const text = 'The dragon platebody is now stronger';
      const matches = findMatches(text, items);

      // Should prefer "Dragon platebody" over just "Dragon"
      expect(matches.length).toBe(1);
      expect(matches[0].name).toBe('Dragon platebody');
    });

    it('should not match items with overlapping claimed words', () => {
      // When items share significant words, only one can be selected
      const items = [
        { id: 1, name: 'Dragon platebody' },
        { id: 2, name: 'Dragon chainbody' },
      ];
      const text = 'The dragon platebody and dragon chainbody are both strong';
      const matches = findMatches(text, items);

      // Only one should match because "dragon" gets claimed
      expect(matches.length).toBe(1);
    });
  });

  describe('case insensitivity', () => {
    it('should match items regardless of case', () => {
      const text = 'DRAGON PLATEBODY and ABYSSAL WHIP are both valuable';
      const matches = findMatches(text, sampleItems);
      const matchedNames = matches.map((m) => m.name);

      expect(matchedNames).toContain('Dragon platebody');
      expect(matchedNames).toContain('Abyssal whip');
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty text', () => {
      const matches = findMatches('', sampleItems);
      expect(matches).toEqual([]);
    });

    it('should return empty array for empty items list', () => {
      const matches = findMatches(samplePostContent.dragonUpdate, []);
      expect(matches).toEqual([]);
    });

    it('should return empty array when no items match', () => {
      const matches = findMatches(samplePostContent.noItemsPost, sampleItems);
      expect(matches).toEqual([]);
    });

    it('should handle items with null/undefined names', () => {
      const items = [
        { id: 1, name: null },
        { id: 2, name: undefined },
        { id: 3, name: 'Dragon platebody' },
      ];
      const text = 'The dragon platebody is great';
      const matches = findMatches(text, items);

      expect(matches.length).toBe(1);
      expect(matches[0].name).toBe('Dragon platebody');
    });
  });
});
