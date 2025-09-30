// tests/itemMatcher.test.js
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { findMatches } from '../src/itemMatcher.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

describe('findMatches()', () => {
  const post18Path   = resolve(__dirname, 'fixtures', '18.txt')
  const itemListPath = resolve(__dirname, 'fixtures', 'all_items.json')

  it('finds exactly the expected 11 items in post 18', async () => {
    const matches = await findMatches(post18Path, itemListPath)
    const names   = matches.map(m => m.name).sort()

    const expected = [
      'Volatile Nightmare Staff',
      'Blood Moon',
      'Blue Moon',
      'Eclipse Moon',
      'Oathplate',
      'Torva',
      'Virtus',
      'Swampbark',
      'Bloodbark',
      'Mixed Hide',
      'Hueycoatl',
      "Acorn",
      "Nightmare staff",
      "Orange",
      "Pumpkin",
      "Rope",
      "Staff",
    ].sort()

    expect(names).toEqual(expected)

    // also sanity‐check that each match has a numeric id
    for (const m of matches) {
      expect(typeof m.id).toBe('number')
      expect(m.id).toBeGreaterThan(0)
    }
  })

  it('returns an empty array when there are no matches', async () => {
    const noMatchPath = resolve(__dirname, 'fixtures', 'no-match.txt')
    const matches     = await findMatches(noMatchPath, itemListPath)
    expect(matches).toEqual([])
  })
})