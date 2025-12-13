// src/utils/config.js

import logger from './logger.js';

/**
 * Validates and loads configuration from environment variables.
 * Fails fast with clear error messages if required values are missing or invalid.
 */
export function loadConfig() {
  const errors = [];

  // Required string values
  const requiredStrings = [
    'DATABASE_URL',
    'RSS_PAGE_URL',
    'MAPPING_API_URL',
    'LATEST_API_URL',
    'OPENAI_API_KEY',
    'OPENAI_MODEL',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ];

  for (const key of requiredStrings) {
    if (!process.env[key]) {
      errors.push(`Missing required environment variable: ${key}`);
    }
  }

  // Validate URLs
  const urlKeys = ['RSS_PAGE_URL', 'MAPPING_API_URL', 'LATEST_API_URL'];
  for (const key of urlKeys) {
    const value = process.env[key];
    if (value && !isValidUrl(value)) {
      errors.push(`Invalid URL for ${key}: ${value}`);
    }
  }

  // Parse numeric values with defaults
  const config = {
    databaseUrl: process.env.DATABASE_URL,
    userAgent: process.env.USER_AGENT || 'surge-bot',
    rssPageUrl: process.env.RSS_PAGE_URL,
    mappingApiUrl: process.env.MAPPING_API_URL,
    latestApiUrl: process.env.LATEST_API_URL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiModel: process.env.OPENAI_MODEL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    rateLimitSeconds: parsePositiveInt(process.env.RATE_LIMIT_SECONDS, 60),
    dataSyncIntervalMinutes: parsePositiveInt(
      process.env.DATA_SYNC_INTERVAL_MINUTES,
      360
    ),
    marginThreshold: parsePositiveInt(process.env.MARGIN_THRESHOLD, 1000000),
    priceVariancePercent: parsePositiveFloat(
      process.env.PRICE_VARIANCE_PERCENT,
      0.05
    ),
    includedChangeTypes: parseJsonArray(process.env.INCLUDED_CHANGE_TYPES, [
      'Price increase',
      'Price decrease',
      'No change',
    ]),
    logLevel: process.env.LOG_LEVEL || 'info',
  };

  // Validate numeric ranges
  if (config.rateLimitSeconds < 1) {
    errors.push('RATE_LIMIT_SECONDS must be at least 1');
  }
  if (config.dataSyncIntervalMinutes < 1) {
    errors.push('DATA_SYNC_INTERVAL_MINUTES must be at least 1');
  }
  if (config.priceVariancePercent < 0 || config.priceVariancePercent > 1) {
    errors.push('PRICE_VARIANCE_PERCENT must be between 0 and 1');
  }

  // Validate included change types
  const validChangeTypes = ['Price increase', 'Price decrease', 'No change'];
  for (const type of config.includedChangeTypes) {
    if (!validChangeTypes.includes(type)) {
      errors.push(`Invalid change type in INCLUDED_CHANGE_TYPES: ${type}`);
    }
  }

  if (errors.length > 0) {
    logger.error('Configuration validation failed', {
      errorCount: errors.length,
    });
    for (const error of errors) {
      logger.error(error);
    }
    throw new Error(
      `Configuration validation failed with ${errors.length} error(s)`
    );
  }

  // Log loaded config (masking secrets)
  logger.info('Configuration loaded successfully', {
    rssPageUrl: config.rssPageUrl,
    rateLimitSeconds: config.rateLimitSeconds,
    dataSyncIntervalMinutes: config.dataSyncIntervalMinutes,
    marginThreshold: config.marginThreshold,
    priceVariancePercent: config.priceVariancePercent,
    includedChangeTypes: config.includedChangeTypes.join(', '),
    openaiModel: config.openaiModel,
  });

  return config;
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

function parsePositiveInt(value, defaultValue) {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) || parsed < 0 ? defaultValue : parsed;
}

function parsePositiveFloat(value, defaultValue) {
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) || parsed < 0 ? defaultValue : parsed;
}

function parseJsonArray(value, defaultValue) {
  if (!value) return defaultValue;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : defaultValue;
  } catch {
    return defaultValue;
  }
}

export default loadConfig;
