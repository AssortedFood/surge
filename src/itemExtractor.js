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

CATEGORY EXPANSIONS - When a category is mentioned, include ALL tradeable variants:

Tiered items (bronze/iron/steel/black/mithril/adamant/rune/dragon):
- "nails" → Bronze nails, Iron nails, Steel nails, Black nails, Mithril nails, Adamantite nails, Rune nails
- "pickaxe" → Bronze pickaxe, Iron pickaxe, Steel pickaxe, Black pickaxe, Mithril pickaxe, Adamant pickaxe, Rune pickaxe, Dragon pickaxe, 3rd age pickaxe, Infernal pickaxe, Crystal pickaxe
- "axe"/"hatchet" → Bronze axe through Dragon axe, Infernal axe, Crystal axe
- "bar" → Bronze bar, Iron bar, Steel bar, Gold bar, Mithril bar, Adamantite bar, Runite bar
- "ore" → Copper ore, Tin ore, Iron ore, Silver ore, Coal, Gold ore, Mithril ore, Adamantite ore, Runite ore

Resources:
- "logs" → Logs, Oak logs, Willow logs, Maple logs, Yew logs, Magic logs, Redwood logs
- "plank" → Plank, Oak plank, Teak plank, Mahogany plank
- "runes" → Air rune, Water rune, Earth rune, Fire rune, Mind rune, Body rune, Cosmic rune, Chaos rune, Nature rune, Law rune, Death rune, Blood rune, Soul rune, Wrath rune

Consumables:
- "impling jar" → Baby impling jar, Young impling jar, Gourmet impling jar, Earth impling jar, Essence impling jar, Eclectic impling jar, Nature impling jar, Magpie impling jar, Ninja impling jar, Crystal impling jar, Dragon impling jar, Lucky impling jar
- "chinchompa" → Chinchompa, Red chinchompa, Black chinchompa
- Potions → Include all dose variants with notation: (4), (3), (2), (1)
  Example: "anti-venom" → Anti-venom(4), Anti-venom(3), Anti-venom(2), Anti-venom(1)

Armor sets:
- Include each piece separately AND the set box
- Example: "Virtus" → Virtus mask, Virtus robe top, Virtus robe bottom, Virtus armour set
- Example: "Inquisitor's" → Inquisitor's great helm, Inquisitor's hauberk, Inquisitor's plateskirt, Inquisitor's mace

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

FALSE POSITIVES TO AVOID:
- "staff" when referring to Jagex employees (NOT tradeable Staff of X)
- JMod names: Pumpkin, Acorn, Ash, Grace, Mod X
- Generic words in non-item context: "shield your account", "gold sellers", "drop rate", "item scammers"
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
- category_expansion: You expanded from a category mention (e.g., "nails" → "Bronze nails")`;

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
