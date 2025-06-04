# Surge

## Overview

Surge monitors Old School RuneScape update posts, identifies mentioned items, analyses their likely price impact using an AI model, and sends alerts via Telegram.

> [!CAUTION]
> The “expected_price_change” prediction is based on AI analysis and might not reflect market conditions accurately. Always double-check alerts before trading.

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

Alternatively, you can use Docker Compose instead of installing locally:

1. Ensure Docker and Docker Compose are installed.
2. Copy or create the `docker-compose.yml` and corresponding `.env` file as shown below.
3. From the project root, run:

   ```bash
   docker compose up -d
   ```

   This will pull `0xidising/surge:latest` and start Surge in a container.

> [!TIP]
> If you’re only testing installing locally with `npm install` is usually faster. Use Docker Compose for a more consistent, isolated environment (e.g. on a server).

## Configuration

Create a `.env` file in the project root with:

```ini
USER_AGENT="surge: item-price-analysis-bot - @your_username_here on Discord"
RSS_PAGE_URL="https://secure.runescape.com/m=news/a=13/latest_news.rss?oldschool=true"
ITEM_LIST_URL="https://prices.runescape.wiki/api/v1/osrs/mapping"
RSS_CHECK_INTERVAL="60"
OPENAI_API_KEY="sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
OPENAI_MODEL="gpt-4.1-mini"
TELEGRAM_BOT_TOKEN="123456789:ABCDEFGHIJKLMNOPQRSTUVWX"
TELEGRAM_CHAT_ID="1234567890"
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

> [!WARNING]
> Setting `RSS_CHECK_INTERVAL` too low (e.g. under 60 seconds) could lead to throttling by the RSS server.

## Usage

Start the service:

```bash
npm start
```

If you started Surge via Docker Compose, logs can be viewed with:

```bash
docker compose logs -f surge
```

To stop the container:

```bash
docker compose down
```

Make sure you have a `.env` file next to `docker-compose.yml` with all `SURGE_…` variables defined (see the Docker Compose example).

Surge will:

1. Create `data/posts/` and `data/analysis/` if missing.
2. Poll the RSS feed immediately and then every `RSS_CHECK_INTERVAL` seconds.
3. For each new post, fetch its content, match items, analyse via AI, and send Telegram alerts as configured.

## Docker Compose

Below is a template for running Surge via Docker Compose. Adjust the environment variables as needed in your host environment or in an `.env` file:

```yaml
# docker-compose.yml
services:
  surge:
    image: 0xidising/surge:latest
    container_name: surge
    pull_policy: always
    restart: unless-stopped
    environment:
      USER_AGENT: ${SURGE_USER_AGENT}
      RSS_PAGE_URL: ${SURGE_RSS_PAGE_URL}
      ITEM_LIST_URL: ${SURGE_ITEM_LIST_URL}
      RSS_CHECK_INTERVAL: ${SURGE_RSS_CHECK_INTERVAL}
      OPENAI_API_KEY: ${SURGE_OPENAI_API_KEY}
      OPENAI_MODEL: ${SURGE_OPENAI_MODEL}
      TELEGRAM_BOT_TOKEN: ${SURGE_TELEGRAM_BOT_TOKEN}
      TELEGRAM_CHAT_ID: ${SURGE_TELEGRAM_CHAT_ID}
      INCLUDED_CHANGE_TYPES: ${SURGE_INCLUDED_CHANGE_TYPES}
```

To start Surge with Docker Compose:

```bash
docker compose up -d
```

Ensure you have set the corresponding `SURGE_…` variables in your environment or in a `.env` file next to `docker-compose.yml`.

```env
# surge
SURGE_USER_AGENT="surge: item-price-analysis-bot - @your_username_here on Discord"
SURGE_RSS_PAGE_URL="https://secure.runescape.com/m=news/a=13/latest_news.rss?oldschool=true"
SURGE_ITEM_LIST_URL="https://prices.runescape.wiki/api/v1/osrs/mapping"
SURGE_RSS_CHECK_INTERVAL="60"
SURGE_OPENAI_API_KEY="sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
SURGE_OPENAI_MODEL="gpt-4.1-mini"
SURGE_TELEGRAM_BOT_TOKEN="123456789:ABCDEFGHIJKLMNOPQRSTUVWX"
SURGE_TELEGRAM_CHAT_ID="1234567890"
SURGE_INCLUDED_CHANGE_TYPES=["Price increase","Price decrease"]
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

* **Analyse one item via AI**

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
