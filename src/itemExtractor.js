// src/itemExtractor.js
import 'dotenv/config';
import { fetchStructuredResponse } from './fetchStructuredResponse.js';
import { ItemExtractionSchema } from '../schemas/ItemExtractionSchema.js';
import logger from './utils/logger.js';

// Default model config from env vars
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'o4-mini';
const DEFAULT_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || null;

const systemPrompt = `You are an Old School RuneScape expert. Extract tradeable items that are EXPLICITLY mentioned in this news post.

CRITICAL: Only extract items that are actually discussed in the post. Do NOT speculatively expand categories or guess at items.

Rules:
- Only include items tradeable on the Grand Exchange
- Extract items that are NAMED or CLEARLY IMPLIED in the text
- If a specific item is named (e.g., "Dragon Bones", "Wyrm Bones"), extract it
- Do NOT expand generic category words into full lists (e.g., "bones" alone → don't list all bone types)
- Do NOT include: quest items, untradeable rewards, currencies (coins/gp), NPCs, locations, skills
- When an armor SET is mentioned by name (e.g., "Virtus", "Inquisitor's"), include ALL individual pieces:
  - Virtus → Virtus mask, Virtus robe top, Virtus robe bottom
  - Inquisitor's → Inquisitor's great helm, Inquisitor's hauberk, Inquisitor's plateskirt, Inquisitor's mace

COMMON ABBREVIATIONS - expand only when the abbreviation appears:
- BP/blowpipe → Toxic blowpipe
- DFS → Dragonfire shield
- SGS/AGS/BGS/ZGS → Saradomin/Armadyl/Bandos/Zamorak godsword
- BCP → Bandos chestplate
- Tassets → Bandos tassets
- Tbow → Twisted bow
- Scythe → Scythe of vitur
- Sang → Sanguinesti staff
- Fang → Osmumten's fang
- Rapier → Ghrazi rapier
- Bowfa → Bow of faerdhinen

VARIANT NOTATION - Preserve exact in-game notation:
- Dose variants: (4), (3), (2), (1)
- Poison variants: (p), (p+), (p++)
- Ornament kits: (or), (g), (t)

FALSE POSITIVES TO AVOID:
- "staff" referring to Jagex employees (NOT Staff of X items)
- JMod names that match items: Ash, Grace, Acorn, Pumpkin
- Generic category words without specific items: "bones", "ores", "logs", "runes", "potions"
- Untradeable: quest capes, skill capes, void equipment, graceful outfit
- Currencies: coins, gp, gold pieces

EDGE CASES - Extract these patterns:
- Items in comparisons: "X is better than Dragon sword" → extract Dragon sword
- Items in requirements: "requires 56 Teak planks" → extract Teak plank
- Items in set bonuses: "Virtus set effect" → extract all Virtus pieces
- Items as rewards/drops: "drops Wyrm bones" → extract Wyrm bones
- Items with specific counts: "15 Cannonballs" → extract Cannonball

DO NOT extract:
- Items only mentioned as examples of what NOT to do
- Items in hypothetical scenarios ("if you had a...")
- Generic category words without specific types

Context classifications:
- buff: Item being made stronger
- nerf: Item being made weaker
- supply_change: Drop rate or availability changing
- new_content: New item being added
- bug_fix: Bug fix related to item
- mention_only: Item mentioned without gameplay change

OUTPUT REQUIREMENTS:
1. name: Exact item name as it appears in-game
2. snippet: Text where item is mentioned (max 400 chars)
3. context: One of the classifications above
4. confidence: 0.0-1.0 (0.9+ for explicit mentions, lower for implied)
5. mentionType: "direct" (named), "implied" (referenced indirectly), or "category_expansion" (expanded from set name)
6. variantCategory: Only if expanded from a set/category name, otherwise null`;

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
