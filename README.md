# Surge

### Objective

Create a lean, modular service that:

1. Fetches the OSRS item list once a day and keeps it up to date.
2. Watches the Old School RuneScape updates RSS feed for new entries.
3. Identifies newly mentioned items against the daily list.
4. Delivers prediction-only spike alerts—item names and update link—via Telegram.

All modules must be single-purpose, easily swappable and minimal in dependencies.