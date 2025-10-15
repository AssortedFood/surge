// src/genericWords.js

export const GENERIC_WORDS = new Set([
  // Equipment slots
  'helm', 'hat', 'coif', 'mask', 'hood',
  'chest', 'body', 'plate', 'platebody', 'top', 'shirt',
  'legs', 'platelegs', 'bottom', 'bottoms', 'skirt', 'chaps', 'trousers',
  'robe', 'robebottom', 'robetop',
  'cape', 'boots', 'gloves', 'gauntlets', 'vambraces',

  // Weapon & Shield Types
  'dagger', 'sword', 'scimitar', 'longsword',
  'bow', 'shortbow', 'crossbow',
  'axe', 'pickaxe', 'spear',
  'shield', 'kiteshield',

  // Accessories & Ammo
  'ring', 'amulet', 'bracelet', 'necklace',
  'orb', 'trident', 'bolt', 'arrow', 'dart', 'javelin', 'tips',

  // Consumables & Tools
  'potion', 'mix', 'scroll', 'tablet', 'bar', 'pie', 'page',
  'seed', 'key', 'jar', 'bones', 'meat', 'logs', 'fur',

  // Containers & Kits
  'bag', 'box', 'case', 'barrel', 'kit',

  // Common Modifiers (often noise)
  'super', 'magic', 'mystic', 'ornament', 'divine', 'elegant', '3rd', 'age',
  'ensouled', 'grimy', 'cooked', 'trimmed', 'extended', 'gilded',

  // Misc words that function as categories
  'sigil', 'relic', 'talisman', 'hunter', 'combat', 'mage', 'range',
  'set', 'teleport', 'visage',

  // Articles, prepositions, and other true generics
  'a', 'an', 'and', 'of', 'the', 'full', 'head', 'hole', 'can', 'ash',
  'remains', 'white', 'west',
])