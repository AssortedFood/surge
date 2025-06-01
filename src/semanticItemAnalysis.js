// src/semanticItemAnalysis.js
import 'dotenv/config';
import fs from 'fs/promises';
import { resolve } from 'path';
import { fetchStructuredResponse } from './fetchStructuredResponse.js';
import { ItemAnalysisSchema } from '../schemas/ItemAnalysisSchema.js';

const DEBUG = false;
const MODEL = process.env.OPENAI_API_MODEL || process.env.OPENAI_MODEL;

if (!MODEL) {
  console.error("❌ Error: OPENAI_MODEL is not defined in the .env file.");
  process.exit(1);
}

/**
 * Analyzes a post's content for its impact on a specific item.
 *
 * @param {string} postFilePath - Path to the post text file
 * @param {string} itemName     - Name of the item to analyze
 * @returns {Promise<{ relevant_text_snippet: string, expected_price_change: string }>}
 */
async function analyzeItemImpact(postFilePath, itemName) {
  if (DEBUG) console.debug(`📄 Reading post file from: ${postFilePath}`);
  const rawPost = await fs.readFile(postFilePath, 'utf-8');

  if (DEBUG) {
    console.debug(`📦 Using model: ${MODEL}`);
    console.debug(`🎯 Analyzing item: ${itemName}`);
  }

  // 1) Tell the model to be concise and pick the clearest evidence
  const systemMessage = `You are a financial analyst reading update posts for a fantasy economy.
When extracting a “relevant text snippet,” you must pick the **single most important sentence or two** 
that directly speaks to the price movement of the item. Keep that snippet under **200 characters** 
and do not include any extra context or filler.`;

  // 2) Remind it again in the user prompt about length & importance
  const userMessage = `Here is the post content:
"""
${rawPost}
"""

Focus on this item: "${itemName}"

Return:
- A **very short snippet** (no more than 2 sentences, and under 200 characters) that directly shows how "${itemName}" is affected.
- The **expected price change** (one of: Price increase, Price decrease, No change)`;

  if (DEBUG) console.debug("🧠 Sending structured prompt to fetchStructuredResponse...");

  try {
    // Fetch the raw completion (which includes our Zod‐formatted output)
    const rawResponse = await fetchStructuredResponse(
      MODEL,
      systemMessage,
      userMessage,
      ItemAnalysisSchema
    );

    if (DEBUG) console.debug("✅ Received raw response from OpenAI:", rawResponse);

    // Extract the Zod‐validated object from message.parsed OR fallback to content
    const message = rawResponse.choices?.[0]?.message;
    if (!message) {
      throw new Error("No choices[0].message found in raw response.");
    }

    // 3a) First try: look for message.parsed
    if (message.parsed && typeof message.parsed === 'object') {
      return {
        relevant_text_snippet: message.parsed.relevant_text_snippet,
        expected_price_change: message.parsed.expected_price_change
      };
    }

    // 3b) Fallback: JSON.parse(message.content)
    if (message.content) {
      let parsedFromContent;
      try {
        parsedFromContent = JSON.parse(message.content);
      } catch (parseErr) {
        throw new Error(
          "Could not JSON.parse(message.content). Received content:\n" +
          message.content
        );
      }

      return {
        relevant_text_snippet: parsedFromContent.relevant_text_snippet,
        expected_price_change: parsedFromContent.expected_price_change
      };
    }

    throw new Error(
      "Neither message.parsed nor message.content contained a valid JSON payload."
    );
  } catch (err) {
    console.error("❌ fetchStructuredResponse threw an error:");
    console.error(err);
    throw err;
  }
}

// CLI usage: node src/semanticItemAnalysis.js data/posts/3.txt "Zulrah's scales"
if (import.meta.url === `file://${process.argv[1]}`) {
  const postPath = process.argv[2];
  const itemName = process.argv.slice(3).join(" ");

  if (!postPath || !itemName) {
    console.error("Usage: node src/semanticItemAnalysis.js <postFilePath> <itemName>");
    process.exit(1);
  }

  const resolvedPath = resolve(process.cwd(), postPath);

  analyzeItemImpact(resolvedPath, itemName)
    .then((result) => {
      console.log("📌 Relevant Snippet:\n", result.relevant_text_snippet);
      console.log("📈 Expected Price Change:", result.expected_price_change);
    })
    .catch((err) => {
      console.error("❌ Error during analysis:", err.message);
      process.exit(1);
    });
}

export { analyzeItemImpact };
