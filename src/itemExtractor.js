// src/itemExtractor.js
import 'dotenv/config';
import { fetchStructuredResponse } from './fetchStructuredResponse.js';
import { ItemExtractionSchema } from '../schemas/ItemExtractionSchema.js';
import logger from './utils/logger.js';

// Default model config from env vars
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'o4-mini';
const DEFAULT_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || null;

const systemPrompt = `You are an Old School RuneScape expert. Extract ALL tradeable items mentioned or implied in this news post. Be thorough and comprehensive.

Rules:
- Only include items that can be traded on the Grand Exchange
- Do NOT include: quest items, untradeable rewards, currencies (coins/gp), NPCs, locations, skills
- Extract individual armor/weapon pieces separately, not just full sets
- Include newly announced items even if they aren't released yet
- For each item, provide a confidence score (0.0-1.0) based on how certain you are it's a tradeable item

CATEGORY EXPANSIONS - CRITICAL: When a category word appears (singular OR plural), you MUST expand it to ALL variants listed below. This is essential for complete extraction:

Tiered items (bronze/iron/steel/black/mithril/adamant/rune/dragon):
- "nails"/"nail" → Bronze nails, Iron nails, Steel nails, Black nails, Mithril nails, Adamantite nails, Rune nails
- "pickaxe"/"pickaxes" → Bronze pickaxe, Iron pickaxe, Steel pickaxe, Black pickaxe, Mithril pickaxe, Adamant pickaxe, Rune pickaxe, Dragon pickaxe, 3rd age pickaxe, Infernal pickaxe, Crystal pickaxe
- "axe"/"axes"/"hatchet" → Bronze axe, Iron axe, Steel axe, Black axe, Mithril axe, Adamant axe, Rune axe, Dragon axe, Infernal axe, Crystal axe
- "bar"/"bars" → Bronze bar, Iron bar, Steel bar, Gold bar, Mithril bar, Adamantite bar, Runite bar
- "ore"/"ores" → Copper ore, Tin ore, Iron ore, Silver ore, Coal, Gold ore, Mithril ore, Adamantite ore, Runite ore

Resources:
- "log"/"logs" → Logs, Oak logs, Willow logs, Maple logs, Yew logs, Magic logs, Redwood logs
- "plank"/"planks" → Plank, Oak plank, Teak plank, Mahogany plank
- "rune"/"runes" → Air rune, Water rune, Earth rune, Fire rune, Mind rune, Body rune, Cosmic rune, Chaos rune, Nature rune, Law rune, Death rune, Blood rune, Soul rune, Wrath rune, Sunfire rune

Consumables:
- "impling"/"implings"/"impling jar"/"impling jars" → Baby impling jar, Young impling jar, Gourmet impling jar, Earth impling jar, Essence impling jar, Eclectic impling jar, Nature impling jar, Magpie impling jar, Ninja impling jar, Crystal impling jar, Dragon impling jar, Lucky impling jar
- "chinchompa"/"chinchompas"/"chins" → Chinchompa, Red chinchompa, Black chinchompa
- "chompy"/"chompies" → Raw chompy, Cooked chompy
- Potions → Include all dose variants with notation: (4), (3), (2), (1)
  Example: "anti-venom+" → Anti-venom+(4), Anti-venom+(3), Anti-venom+(2), Anti-venom+(1)
  Example: "super restore" → Super restore(4), Super restore(3), Super restore(2), Super restore(1)

Bones:
- "bone"/"bones" (when discussing multiple bone types) → Bones, Big bones, Babydragon bones, Dragon bones, Lava dragon bones, Superior dragon bones, Wyvern bones, Wyrm bones, Drake bones, Hydra bones, Dagannoth bones, Ourg bones, Fayrg bones, Raurg bones

Armor sets and outfits:
- Include each piece separately AND the set box if it exists
- Example: "Virtus" → Virtus mask, Virtus robe top, Virtus robe bottom, Virtus armour set
- Example: "Inquisitor's" → Inquisitor's great helm, Inquisitor's hauberk, Inquisitor's plateskirt, Inquisitor's mace, Inquisitor's armour set
- Example: "HAM" outfit → Ham shirt, Ham robe, Ham hood, Ham cloak, Ham logo, Ham gloves, Ham boots
- Example: "Sunfire fanatic" → Sunfire fanatic helm, Sunfire fanatic cuirass, Sunfire fanatic chausses, Sunfire fanatic armour set

Color variants:
- When an item has color variants, include ALL colors
- Example: "bandana eyepatch" → Red bandana eyepatch, Blue bandana eyepatch, White bandana eyepatch, Purple bandana eyepatch
- Example: "partyhat" → Red partyhat, Yellow partyhat, Green partyhat, Blue partyhat, Purple partyhat, White partyhat
- Example: "halloween mask" → Red halloween mask, Green halloween mask, Blue halloween mask

VARIANT NOTATION - Preserve exact notation:
- Dose variants: (4), (3), (2), (1)
- Poison variants: (p), (p+), (p++)
- State variants: (inactive), (uncharged), (empty)
- Ornament kits: (or), (g), (t)
- Degradation: (full), (100), (75), etc.

COMPOUND ITEM PATTERNS:
- "Ring of X" → Ring of wealth, Ring of suffering, Ring of endurance, etc.
- "Amulet of X" → Amulet of glory, Amulet of fury, Amulet of torture, etc.
- "Boots of X" → Boots of lightness, Boots of brimstone, etc.
- "Cape of X" → Cape of legends (if tradeable)

COMMON ABBREVIATIONS (expand these):
- BP/blowpipe → Toxic blowpipe
- DFS → Dragonfire shield
- SGS/AGS/BGS/ZGS → Saradomin/Armadyl/Bandos/Zamorak godsword
- BCP → Bandos chestplate
- Tassets → Bandos tassets
- Prims → Primordial boots
- Pegs → Pegasian boots
- Eternals → Eternal boots
- Tent → Abyssal tentacle
- Whip → Abyssal whip
- Sang → Sanguinesti staff
- Scythe → Scythe of vitur
- Tbow → Twisted bow
- Bowfa → Bow of faerdhinen
- Rapier → Ghrazi rapier
- Fang → Osmumten's fang

Specific tradeable items to look for:
- Rune pouch note (tradeable version of rune pouch)
- Sunfire rune (new rune type)
- Graceful ornament kit (tradeable, unlike graceful outfit itself)
- Chugging barrel (NOT "chugging barrel (disassembled)")
- Damaged monkey tail (tradeable drop)
- Broken zombie axe (tradeable drop)

FALSE POSITIVES TO AVOID:
- "staff" when referring to Jagex employees (NOT tradeable Staff of X)
- JMod names: Pumpkin, Acorn, Ash, Grace, Mod X
- Generic words in non-item context: "shield your account", "gold sellers", "drop rate", "item scammers"
- Color words when not part of item name: "orange" (the color), "red" (the color), "blue" (the color)
- Untradeable: quest capes, skill capes (99 capes), void equipment, graceful outfit, Ava's devices
- RS3-only items (this is OSRS only)
- Currencies: coins, gp, gold pieces, tokkul, platinum tokens

Context classifications:
- buff: Item is being made stronger or more useful
- nerf: Item is being made weaker or less useful
- supply_change: Drop rate, source, or availability is changing
- new_content: Item is part of new content being added
- bug_fix: A bug related to the item is being fixed
- mention_only: Item is mentioned but no gameplay change

Mention types:
- direct: Item name appears explicitly in the text
- implied: Item is implied but not named (e.g., "the weapon from CoX" implies Twisted bow)
- category_expansion: You expanded from a category mention (e.g., "nails" → "Bronze nails")

OUTPUT REQUIREMENTS - For EACH item you MUST provide:
1. name: The exact item name as it appears in-game
2. snippet: The text where this item is mentioned (max 400 chars)
3. context: One of buff/nerf/supply_change/new_content/bug_fix/mention_only
4. confidence: A number 0.0-1.0 indicating certainty this is a tradeable item
   - 0.9-1.0: Exact item name mentioned, clearly tradeable
   - 0.7-0.9: Strong context suggests this item
   - 0.5-0.7: Item implied or uncertain tradeability
   - <0.5: Weak evidence, might not be an item
5. mentionType: One of direct/implied/category_expansion
6. variantCategory: If from category expansion, name the category (e.g., "nails", "pickaxes"); otherwise omit`;

/**
 * Extracts item candidates from cleaned post content using LLM.
 * @param {string} postTitle - The title of the post
 * @param {string} cleanedContent - The cleaned post content (noise removed)
 * @param {object} modelConfig - Optional model configuration {model, reasoning}
 * @returns {Promise<{items: Array<{name: string, snippet: string, context: string}>, usage: object}>}
 */
async function extractItemCandidates(
  postTitle,
  cleanedContent,
  modelConfig = {}
) {
  const model = modelConfig.model || DEFAULT_MODEL;
  const reasoning = modelConfig.reasoning || DEFAULT_REASONING_EFFORT;

  const userMessage = `Post Title: "${postTitle}"

Content:
"""
${cleanedContent}
"""

Extract all tradeable OSRS items mentioned in this post.`;

  try {
    const rawResponse = await fetchStructuredResponse(
      model,
      systemPrompt,
      userMessage,
      ItemExtractionSchema,
      { reasoningEffort: reasoning }
    );

    const usage = {
      promptTokens: rawResponse.usage?.prompt_tokens || 0,
      completionTokens: rawResponse.usage?.completion_tokens || 0,
      reasoningTokens:
        rawResponse.usage?.completion_tokens_details?.reasoning_tokens || 0,
    };

    const message = rawResponse.choices?.[0]?.message;
    if (!message) {
      throw new Error('No choices[0].message found in OpenAI response.');
    }

    let result;
    if (message.parsed) {
      result = message.parsed;
    } else if (message.content) {
      result = JSON.parse(message.content);
    } else {
      throw new Error(
        'Neither message.parsed nor message.content contained a valid JSON payload.'
      );
    }

    logger.debug('Extracted item candidates', {
      postTitle,
      itemCount: result.items?.length || 0,
    });

    return { items: result.items || [], usage };
  } catch (err) {
    logger.error('Item extraction failed', {
      error: err.message,
      postTitle,
    });
    throw err;
  }
}

export { extractItemCandidates };
