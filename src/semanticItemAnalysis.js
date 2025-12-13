// src/semanticItemAnalysis.js
import 'dotenv/config';
import { fetchStructuredResponse } from './fetchStructuredResponse.js';
import { ItemAnalysisSchema } from '../schemas/ItemAnalysisSchema.js';
import logger from './utils/logger.js';

const MODEL = process.env.OPENAI_MODEL;
if (!MODEL) {
  logger.error('OPENAI_MODEL is not defined in the .env file');
  process.exit(1);
}

/**
 * Analyzes a post's content for its impact on a specific item.
 * @param {string} postContent - The raw text content of the post.
 * @param {string} itemName    - Name of the item to analyze.
 * @returns {Promise<{ relevant_text_snippet: string, expected_price_change: string }>}
 */
async function analyzeItemImpact(postContent, itemName) {
  const systemMessage = `You are a financial analyst reading update posts for a fantasy economy.
When extracting a “relevant text snippet,” you must pick the **single most important sentence or two** that directly speaks to the price movement of the item. Keep that snippet under **200 characters** and do not include any extra context or filler.`;

  const userMessage = `Here is the post content:
"""
${postContent}
"""

Focus on this item: "${itemName}"

Return:
- A **very short snippet** (no more than 2 sentences, and under 200 characters) that directly shows how "${itemName}" is affected.
- The **expected price change** (one of: Price increase, Price decrease, No change)`;

  try {
    const rawResponse = await fetchStructuredResponse(
      MODEL,
      systemMessage,
      userMessage,
      ItemAnalysisSchema
    );

    const message = rawResponse.choices?.[0]?.message;
    if (!message) {
      throw new Error('No choices[0].message found in OpenAI response.');
    }

    if (message.parsed) {
      return message.parsed;
    }
    if (message.content) {
      return JSON.parse(message.content);
    }

    throw new Error(
      'Neither message.parsed nor message.content contained a valid JSON payload.'
    );
  } catch (err) {
    logger.error('fetchStructuredResponse threw an error', {
      error: err.message,
    });
    throw err;
  }
}

export { analyzeItemImpact };
