// src/itemExtractor.js
import 'dotenv/config';
import { fetchStructuredResponse } from './fetchStructuredResponse.js';
import { ItemExtractionSchema } from '../schemas/ItemExtractionSchema.js';
import logger from './utils/logger.js';

const MODEL = process.env.OPENAI_MODEL;
if (!MODEL) {
  logger.error('OPENAI_MODEL is not defined in the .env file');
  process.exit(1);
}

// Optional reasoning effort for reasoning models (o4-mini, gpt-5-mini)
// Valid values: low, medium, high
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || null;

const systemPrompt = `You are an Old School RuneScape expert. Extract ALL tradeable items mentioned or implied in this news post. Be thorough and comprehensive.

Rules:
- Only include items that can be traded on the Grand Exchange
- Do NOT include: quest items, untradeable rewards, currencies (coins/gp), NPCs, locations, skills
- IMPORTANT: When an item category is mentioned, include ALL tradeable variants:
  - "nails" → Bronze nails, Iron nails, Steel nails, Black nails, Mithril nails, Adamantite nails, Rune nails
  - "pickaxe" → Bronze pickaxe, Iron pickaxe, Steel pickaxe, Black pickaxe, Mithril pickaxe, Adamant pickaxe, Rune pickaxe, Dragon pickaxe, Infernal pickaxe, Crystal pickaxe
  - "impling jar" → Baby impling jar, Young impling jar, Gourmet impling jar, Earth impling jar, Essence impling jar, Eclectic impling jar, Nature impling jar, Magpie impling jar, Ninja impling jar, Crystal impling jar, Dragon impling jar, Lucky impling jar
  - Armour sets → Include each piece AND the set box (e.g., Virtus mask, Virtus robe top, Virtus robe bottom, Virtus armour set)
  - Potions → Include all dose variants (e.g., Anti-venom(4), Anti-venom(3), Anti-venom(2), Anti-venom(1))
  - "chinchompa" → Chinchompa, Red chinchompa, Black chinchompa
  - "bones" → Include specific bone types mentioned in context
- Include the exact snippet where the item category is mentioned (max 200 chars)
- Classify WHY the item is mentioned

Common false positives to AVOID:
- "staff" when referring to Jagex employees
- JMod names that match items (Pumpkin, Acorn, Ash, Grace, etc.)
- Generic words in non-item context (e.g., "shield your account", "gold sellers")
- Untradeable items: quest capes, skill capes, void equipment, graceful outfit pieces
- RS3-only items (this is OSRS)

Context classifications:
- buff: Item is being made stronger or more useful
- nerf: Item is being made weaker or less useful
- supply_change: Drop rate, source, or availability is changing
- new_content: Item is part of new content being added
- bug_fix: A bug related to the item is being fixed
- mention_only: Item is mentioned but no gameplay change`;

/**
 * Extracts item candidates from cleaned post content using LLM.
 * @param {string} postTitle - The title of the post
 * @param {string} cleanedContent - The cleaned post content (noise removed)
 * @returns {Promise<Array<{name: string, snippet: string, context: string}>>}
 */
async function extractItemCandidates(postTitle, cleanedContent) {
  const userMessage = `Post Title: "${postTitle}"

Content:
"""
${cleanedContent}
"""

Extract all tradeable OSRS items mentioned in this post.`;

  try {
    const rawResponse = await fetchStructuredResponse(
      MODEL,
      systemPrompt,
      userMessage,
      ItemExtractionSchema,
      { reasoningEffort: REASONING_EFFORT }
    );

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

    return result.items || [];
  } catch (err) {
    logger.error('Item extraction failed', {
      error: err.message,
      postTitle,
    });
    throw err;
  }
}

export { extractItemCandidates };
