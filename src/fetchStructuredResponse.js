// src/fetchStructuredResponse.js
import 'dotenv/config';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import logger from './utils/logger.js';
import { withRetry } from './utils/retry.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function fetchStructuredResponse(
  model,
  systemMessage,
  userMessage,
  zodSchemaObject
) {
  return withRetry(
    async () => {
      logger.debug('Sending OpenAI request', { model });

      const response = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
        ],
        response_format: zodResponseFormat(zodSchemaObject, 'response'),
      });

      logger.debug('OpenAI response received', {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      });

      return response;
    },
    {
      maxRetries: 3,
      operationName: 'OpenAI API call',
    }
  );
}

export { fetchStructuredResponse };
