# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm start              # Run the service
pnpm test               # Run all tests (vitest)
pnpm run lint           # Check linting
pnpm run lint:fix       # Fix linting issues
pnpm run format         # Format with Prettier
pnpm run format:check   # Check formatting
```

## Architecture

Surge monitors Old School RuneScape news posts, extracts mentioned items using AI, predicts price impacts, and sends Telegram alerts.

### Data Flow

1. **syncData.js** - Syncs item database and price snapshots from OSRS Wiki API (runs on interval)
2. **syncPosts.js** - Polls RSS feed, scrapes article content with Puppeteer
3. **contentCleaner.js** - Strips boilerplate (JMod signatures, social links, media placeholders)
4. **hybridExtractor.js** - Core extraction pipeline (see below)
5. **itemFilter.js** - Filters to economically significant items (margin × buy limit, volatility thresholds)
6. **pricePredictor.js** - LLM predicts price direction from context
7. **sendTelegram.js** - Sends HTML alerts via grammy bot

### Hybrid Extraction Pipeline (hybridExtractor.js)

The extraction uses a hybrid approach combining LLM and algorithmic methods:

1. **Parallel extraction**: LLM extraction (`itemExtractor.js`) runs alongside regex word-boundary search
2. **2-run voting**: Extraction runs twice in parallel; items must appear in 60%+ of runs to pass
3. **Validation**: Results validated against item database using fuzzy matching (`itemValidator.js` - Levenshtein distance)
4. **Confidence scoring**: Items tagged by source (both, llm-only, algo-validated) with confidence scores

The blocklist in `hybridExtractor.js` filters ambiguous terms (JMod names, skill names, generic words like "gold", "rune").

### Database (Prisma/SQLite)

- **Item** - OSRS items with metadata (id, name, buy limit, alch values)
- **PriceSnapshot** - Historical high/low prices per item
- **Post** - News posts with content and isAnalyzed flag
- **ItemAnalysis** - Extracted items per post with predicted price change
- **AppState** - Key-value store for scheduler timestamps

### Schemas (schemas/)

Zod schemas for OpenAI structured outputs:
- **ItemExtractionSchema** - Item extraction response format (name, snippet, context, confidence)
- **PricePredictionSchema** - Price prediction response (direction, reasoning)

### Utilities (src/utils/)

- **config.js** - Validates and loads environment config at startup
- **retry.js** - Exponential backoff with jitter for API calls
- **logger.js** - Structured logging with levels (debug/info/warn/error)

## Configuration

Key environment variables (see README.md for full list):
- `OPENAI_MODEL` / `OPENAI_REASONING_EFFORT` - Model config (e.g., gpt-5-mini with medium reasoning)
- `MARGIN_THRESHOLD` - Minimum economic significance (price × buy limit)
- `PRICE_VARIANCE_PERCENT` - Minimum volatility threshold
- `INCLUDED_CHANGE_TYPES` - Which predictions to alert on (increase/decrease/no change)
