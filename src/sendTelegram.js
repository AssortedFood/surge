#!/usr/bin/env node
// src/sendTelegram.js
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID  = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error(
    'Error: Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your .env'
  );
  process.exit(1);
}

// Instantiate the bot (no polling needed for sendMessage)
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// Grab the message text from command-line args:
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node sendTelegram.js "<your message here>"');
  process.exit(1);
}
const text = args.join(' ');

// Send as HTML so hyphens and most punctuation don’t need escaping:
bot
  .sendMessage(CHAT_ID, text, { parse_mode: 'HTML' })
  .then((result) => {
    console.log('✅ Message sent, message_id:', result.message_id);
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error sending message:', err);
    process.exit(1);
  });
