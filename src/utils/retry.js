// src/utils/retry.js

import logger from './logger.js';

/**
 * Executes a function with retry logic and exponential backoff.
 *
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.baseDelayMs - Base delay in milliseconds (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay cap in milliseconds (default: 30000)
 * @param {Function} options.shouldRetry - Function to determine if error is retryable (default: retries on network/5xx)
 * @param {string} options.operationName - Name for logging purposes
 * @returns {Promise<*>} - Result of the function
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    shouldRetry = isRetryableError,
    operationName = 'operation',
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt > maxRetries || !shouldRetry(error)) {
        logger.error(`${operationName} failed after ${attempt} attempt(s)`, {
          error: error.message,
          retryable: shouldRetry(error),
        });
        throw error;
      }

      const delay = calculateBackoff(attempt, baseDelayMs, maxDelayMs);
      logger.warn(`${operationName} failed, retrying`, {
        attempt,
        maxRetries,
        delayMs: delay,
        error: error.message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Calculate exponential backoff with jitter.
 */
function calculateBackoff(attempt, baseDelayMs, maxDelayMs) {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Default retry logic - retries on network errors and 5xx responses.
 */
export function isRetryableError(error) {
  // Network errors
  if (
    error.code === 'ECONNRESET' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ENOTFOUND'
  ) {
    return true;
  }

  // Fetch errors with no response (network level)
  if (error.name === 'FetchError' || error.name === 'AbortError') {
    return true;
  }

  // HTTP status code based retry (5xx server errors, 429 rate limit)
  const status = error.status || error.statusCode || error.response?.status;
  if (status) {
    return status >= 500 || status === 429;
  }

  // OpenAI specific errors
  if (
    error.message?.includes('timeout') ||
    error.message?.includes('ECONNRESET')
  ) {
    return true;
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default withRetry;
