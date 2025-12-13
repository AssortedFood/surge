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

      // Reasoning models (o-series, gpt-5-series) don't support temperature
      const isReasoningModel =
        model.startsWith('o') || model.startsWith('gpt-5');

      const requestParams = {
        model: model,
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
        ],
        response_format: zodResponseFormat(zodSchemaObject, 'response'),
      };

      // Only set temperature for non-reasoning models (gpt-4o, gpt-4o-mini, etc.)
      if (!isReasoningModel && options.temperature !== undefined) {
        requestParams.temperature = options.temperature;
      }

      // Add reasoning_effort for reasoning models (o4-mini, gpt-5-mini)
      if (isReasoningModel && options.reasoningEffort) {
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
