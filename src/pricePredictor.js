// src/pricePredictor.js
import 'dotenv/config';
import { fetchStructuredResponse } from './fetchStructuredResponse.js';
import { PricePredictionSchema } from '../schemas/PricePredictionSchema.js';
import logger from './utils/logger.js';

const MODEL = process.env.OPENAI_MODEL;
if (!MODEL) {
  logger.error('OPENAI_MODEL is not defined in the .env file');
  process.exit(1);
}

const systemPrompt = `You are an OSRS market analyst. Given an item and the context of how it's mentioned in a news post, predict if the item's price will increase, decrease, or stay the same.

Consider:
- Supply changes (easier/harder to obtain → price down/up)
- Demand changes (new uses → price up, removed uses → price down)
- Direct buffs/nerfs to the item
- Bug fixes that affect item utility or acquisition
- New content that uses the item as a requirement or ingredient

Be conservative - only predict a price change if there's clear evidence in the context.
If the item is just mentioned without any gameplay change, predict "No change".

Keep reasoning brief (under 100 characters).`;

/**
 * Predicts price direction for a single item based on its mention context.
 * @param {string} itemName - The canonical item name
 * @param {string} snippet - The context snippet where the item was mentioned
 * @returns {Promise<{direction: string, reasoning: string}>}
 */
async function predictPriceChange(itemName, snippet) {
  const userMessage = `Item: ${itemName}

Context from post:
"${snippet}"

Predict the price direction.`;

  try {
    const rawResponse = await fetchStructuredResponse(
      MODEL,
      systemPrompt,
      userMessage,
      PricePredictionSchema
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

    logger.debug('Price prediction complete', {
      itemName,
      direction: result.direction,
    });

    return result;
  } catch (err) {
    logger.error('Price prediction failed', {
      error: err.message,
      itemName,
    });
    throw err;
  }
}

export { predictPriceChange };
