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
  zodSchemaObject,
  options = {}
) {
  return withRetry(
    async () => {
      logger.debug('Sending OpenAI request', {
        model,
        reasoningEffort: options.reasoningEffort,
      });

      const requestParams = {
        model: model,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
        ],
        response_format: zodResponseFormat(zodSchemaObject, 'response'),
      };

      // Add reasoning_effort for reasoning models (o4-mini, gpt-5-mini)
      if (options.reasoningEffort) {
        requestParams.reasoning_effort = options.reasoningEffort;
      }

      const response = await openai.chat.completions.create(requestParams);

      logger.debug('OpenAI response received', {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        reasoningTokens:
          response.usage?.completion_tokens_details?.reasoning_tokens,
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
