# Surge

## Overview

Surge monitors Old School RuneScape update posts, identifies mentioned items, analyses their likely price impact using an AI model, and sends alerts via Telegram.

> [!CAUTION]
> The “expected_price_change” prediction is based on AI analysis and might not reflect market conditions accurately. Always double-check alerts before trading.

## Prerequisites

* Node.js (v22 or later)
* pnpm
* OpenAI API key
* Telegram bot token & chat ID

## Installation

```bash
git clone https://github.com/AssortedFood/surge.git
cd surge
pnpm install
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
> If you're only testing, installing locally with `pnpm install` is usually faster. Use Docker Compose for a more consistent, isolated environment (e.g. on a server).

## Configuration

Create a `.env` file in the project root with:

```ini
DATABASE_URL="file:./database.db"
USER_AGENT="surge: item-price-analysis-bot - @your_username_here on Discord"
RSS_PAGE_URL="https://secure.runescape.com/m=news/a=13/latest_news.rss?oldschool=true"
MAPPING_API_URL="https://prices.runescape.wiki/api/v1/osrs/mapping"
LATEST_API_URL="https://prices.runescape.wiki/api/v1/osrs/latest"
RATE_LIMIT_SECONDS="60"
DATA_SYNC_INTERVAL_MINUTES="360"
OPENAI_API_KEY="sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
OPENAI_MODEL="o4-mini"
OPENAI_REASONING_EFFORT="medium"
TELEGRAM_BOT_TOKEN="123456789:ABCDEFGHIJKLMNOPQRSTUVWX"
TELEGRAM_CHAT_ID="1234567890"
INCLUDED_CHANGE_TYPES=["Price increase","Price decrease"]
MARGIN_THRESHOLD="1000000"
PRICE_VARIANCE_PERCENT="0.05"
```

* `DATABASE_URL`: SQLite database path for Prisma.
* `USER_AGENT`: Custom User-Agent for API requests.
* `RSS_PAGE_URL`: OSRS updates RSS feed.
* `MAPPING_API_URL`: OSRS item-mapping API.
* `LATEST_API_URL`: OSRS latest prices API.
* `RATE_LIMIT_SECONDS`: Seconds between RSS/article fetches (shared rate limit).
* `DATA_SYNC_INTERVAL_MINUTES`: Minutes between item & price data syncs.
* `OPENAI_API_KEY`: Your OpenAI secret key.
* `OPENAI_MODEL`: Model name for item extraction (see benchmark table below).
* `OPENAI_REASONING_EFFORT`: Reasoning effort for `o4-mini`/`gpt-5-mini` models (`low`, `medium`, `high`). Omit for non-reasoning models.

### Model Benchmarks

Benchmarked on 7 diverse posts with 5 runs per configuration (December 2025):

| Model | Reasoning | F1 | Precision | Recall | Latency | Tokens/run | Cost/post |
|-------|-----------|-----|-----------|--------|---------|------------|-----------|
| **o4-mini** | **medium** | **94.2%** | **100%** | **89.1%** | **28s** | **99K** | **~$0.15** |
| gpt-5-mini | low | 94.1% | 100% | 89.1% | 23s | 72K | ~$0.11 |
| gpt-5-mini | medium | 94.0% | 100% | 89.1% | 57s | 108K | ~$0.17 |
| o4-mini | low | 89.4% | 100% | 80.9% | 8s | 57K | ~$0.08 |

*Latency = per post average. Tokens = prompt + completion + reasoning per post. Cost estimated at $1.10/M input + $4.40/M output.*

**Recommendation:** `o4-mini:medium` offers the best accuracy/latency tradeoff (94.2% F1, 100% precision, 28s). Use `gpt-5-mini:low` if cost-sensitive with similar accuracy but lower latency.

### Extraction Pipeline

Surge uses a hybrid extraction approach with 5-run parallel voting:

1. **Instant notification**: When a new post is detected, an alert with the post title and URL is sent immediately
2. **5× parallel extraction**: Five independent LLM extractions run simultaneously
3. **Voting consensus**: Items must appear in 3/5 runs (60% threshold) to pass, filtering out hallucinations
4. **Parallel predictions**: Price change predictions for all items run in parallel, each sending its notification immediately when complete

This approach reduces F1 variance from ±12% to ±3% while maintaining ~30s total latency.

* `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`: For sending alerts.
* `INCLUDED_CHANGE_TYPES`: Valid options are `"Price increase"`, `"Price decrease"`, `"No change"`.
* `MARGIN_THRESHOLD`: Minimum potential profit for item to be considered significant.
* `PRICE_VARIANCE_PERCENT`: Minimum price volatility (e.g., `0.05` = 5%).

> [!WARNING]
> Setting `RATE_LIMIT_SECONDS` too low (e.g. under 60 seconds) could lead to throttling by the RSS server.

## Usage

Start the service:

```bash
pnpm start
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

1. Sync item and price data from the OSRS API on startup and every `DATA_SYNC_INTERVAL_MINUTES`.
2. Poll the RSS feed every `RATE_LIMIT_SECONDS` seconds.
3. For each new post, fetch its content, match economically significant items, analyse via AI, and send Telegram alerts as configured.

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
    volumes:
      - surge-data:/usr/src/app/prisma
    environment:
      DATABASE_URL: ${SURGE_DATABASE_URL}
      USER_AGENT: ${SURGE_USER_AGENT}
      RSS_PAGE_URL: ${SURGE_RSS_PAGE_URL}
      MAPPING_API_URL: ${SURGE_MAPPING_API_URL}
      LATEST_API_URL: ${SURGE_LATEST_API_URL}
      RATE_LIMIT_SECONDS: ${SURGE_RATE_LIMIT_SECONDS}
      DATA_SYNC_INTERVAL_MINUTES: ${SURGE_DATA_SYNC_INTERVAL_MINUTES}
      OPENAI_API_KEY: ${SURGE_OPENAI_API_KEY}
      OPENAI_MODEL: ${SURGE_OPENAI_MODEL}
      OPENAI_REASONING_EFFORT: ${SURGE_OPENAI_REASONING_EFFORT}
      TELEGRAM_BOT_TOKEN: ${SURGE_TELEGRAM_BOT_TOKEN}
      TELEGRAM_CHAT_ID: ${SURGE_TELEGRAM_CHAT_ID}
      INCLUDED_CHANGE_TYPES: ${SURGE_INCLUDED_CHANGE_TYPES}
      MARGIN_THRESHOLD: ${SURGE_MARGIN_THRESHOLD}
      PRICE_VARIANCE_PERCENT: ${SURGE_PRICE_VARIANCE_PERCENT}

volumes:
  surge-data:
```

To start Surge with Docker Compose:

```bash
docker compose up -d
```

Ensure you have set the corresponding `SURGE_…` variables in your environment or in a `.env` file next to `docker-compose.yml`.

```env
# surge
SURGE_DATABASE_URL="file:./database.db"
SURGE_USER_AGENT="surge: item-price-analysis-bot - @your_username_here on Discord"
SURGE_RSS_PAGE_URL="https://secure.runescape.com/m=news/a=13/latest_news.rss?oldschool=true"
SURGE_MAPPING_API_URL="https://prices.runescape.wiki/api/v1/osrs/mapping"
SURGE_LATEST_API_URL="https://prices.runescape.wiki/api/v1/osrs/latest"
SURGE_RATE_LIMIT_SECONDS="60"
SURGE_DATA_SYNC_INTERVAL_MINUTES="360"
SURGE_OPENAI_API_KEY="sk-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
SURGE_OPENAI_MODEL="o4-mini"
SURGE_OPENAI_REASONING_EFFORT="medium"
SURGE_TELEGRAM_BOT_TOKEN="123456789:ABCDEFGHIJKLMNOPQRSTUVWX"
SURGE_TELEGRAM_CHAT_ID="1234567890"
SURGE_INCLUDED_CHANGE_TYPES=["Price increase","Price decrease"]
SURGE_MARGIN_THRESHOLD="1000000"
SURGE_PRICE_VARIANCE_PERCENT="0.05"
```


## Development

```bash
pnpm run lint        # Check for linting errors
pnpm run format      # Format code with Prettier
pnpm test            # Run tests
```

## License

This project is licensed under MIT. See [LICENSE](LICENSE) for details.
