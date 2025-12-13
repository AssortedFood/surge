#!/usr/bin/env node
// src/sendTelegram.js
import 'dotenv/config';
import { Bot } from 'grammy';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error(
    'Error: Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your .env'
  );
  process.exit(1);
}

// Instantiate the bot
const bot = new Bot(BOT_TOKEN);

/**
 * Sends a message to the configured Telegram chat.
 * @param {string} text
 * @returns {Promise<import('grammy').Message.TextMessage>}
 */
export async function sendTelegramMessage(text) {
  return bot.api.sendMessage(CHAT_ID, text, { parse_mode: 'HTML' });
}

// If this file is run directly via `node src/sendTelegram.js "some text"`, use the CLI entrypoint below:
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node src/sendTelegram.js "<your message here>"');
    process.exit(1);
  }
  const text = args.join(' ');
  sendTelegramMessage(text)
    .then((result) => {
      console.log('✅ Message sent, message_id:', result.message_id);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error sending message:', err);
      process.exit(1);
    });
}
