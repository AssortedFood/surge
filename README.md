# Surge

## Overview

Surge monitors Old School RuneScape update posts, identifies mentioned items, analyses their likely price impact using an AI model, and sends alerts via Telegram.

## Prerequisites

* Node.js (v16 or later)
* npm
* OpenAI API key
* Telegram bot token & chat ID

## Installation

```bash
git clone https://github.com/AssortedFood/surge.git
cd surge
npm install
```

## Configuration

Create a `.env` file in the project root with:

```ini
USER_AGENT="surge: item-price-analysis-bot - @your_username_here on Discord"
RSS_PAGE_URL="https://secure.runescape.com/m=news/a=13/latest_news.rss?oldschool=true"
ITEM_LIST_URL="https://prices.runescape.wiki/api/v1/osrs/mapping"
RSS_CHECK_INTERVAL="60"
OPENAI_API_KEY="YOUR_OPENAI_API_KEY"
OPENAI_MODEL="gpt-4.1-mini"
TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN"
TELEGRAM_CHAT_ID="YOUR_TELEGRAM_CHAT_ID"
INCLUDED_CHANGE_TYPES=["Price increase","Price decrease"]
```

* `USER_AGENT`: Custom User-Agent for item-list requests.
* `RSS_PAGE_URL`: OSRS updates RSS feed.
* `ITEM_LIST_URL`: OSRS item-mapping API.
* `RSS_CHECK_INTERVAL`: Seconds between RSS polls.
* `OPENAI_API_KEY`: Your OpenAI secret key.
* `OPENAI_MODEL`: Model name (e.g., `gpt-4.1-mini`).
* `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`: For sending alerts.
* `INCLUDED_CHANGE_TYPES`: ["Price increase","Price decrease", "No change"] are the set of valid options.

## Usage

Start the service:

```bash
npm start
```

Surge will:

1. Create `data/posts/` and `data/analysis/` if missing.
2. Poll the RSS feed immediately and then every `RSS_CHECK_INTERVAL` seconds.
3. For each new post, fetch its content, match items, analyze via AI, and send Telegram alerts as configured.

## Docker Compose

*(Template section; Dockerfile and compose configs to be added later)*

```yaml
# docker-compose.yml
```

## Module Descriptions

Below are the modules that can be invoked directly with Node:

* **Fetch all items list**

  ```bash
  node src/allItemsFetcher.js
  ```

  Fetches the OSRS item mapping from `ITEM_LIST_URL` and writes `data/all_items.json`.

* **Check RSS for new posts**

  ```bash
  node src/rssChecker.js
  ```

  Prints any newly discovered RSS posts (with assigned IDs) and updates `data/seenPosts.json`.

* **Fetch and save a single post**

  ```bash
  node src/rssPostFetcher.js <postId>
  ```

  Reads `data/seenPosts.json` to find the post’s URL, fetches the HTML, extracts paragraphs, and writes `data/posts/<postId>.txt`.

* **Match items in a post**

  ```bash
  node src/itemMatcher.js <path/to/post.txt> <path/to/all_items.json>
  ```

  Scans the plaintext post for mentions of items (case-insensitive, whole words) and prints matching `id: name` pairs.

* **Analyze one item via AI**

  ```bash
  node src/semanticItemAnalysis.js <path/to/post.txt> "<Item Name>"
  ```

  Sends a structured prompt to the AI and prints a JSON object:

  ```json
  {
    "relevant_text_snippet": "...",
    "expected_price_change": "Price increase" | "Price decrease" | "No change"
  }
  ```

* **Send a Telegram message**

  ```bash
  node src/sendTelegram.js "Your message here"
  ```

  Sends the given text to the configured Telegram chat in HTML format.

## License

This project is licensed under MIT. See [LICENSE](LICENSE) for details.
