// src/utils/logger.js

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel =
  LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function formatContext(context) {
  if (!context || Object.keys(context).length === 0) return '';
  return Object.entries(context)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ');
}

function log(level, message, context = {}) {
  if (LOG_LEVELS[level] < currentLevel) return;

  const timestamp = new Date().toISOString();
  const levelStr = level.toUpperCase().padEnd(5);
  const contextStr = formatContext(context);
  const output = contextStr
    ? `[${timestamp}] ${levelStr} ${message} ${contextStr}`
    : `[${timestamp}] ${levelStr} ${message}`;

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (message, context) => log('debug', message, context),
  info: (message, context) => log('info', message, context),
  warn: (message, context) => log('warn', message, context),
  error: (message, context) => log('error', message, context),
};

export default logger;
