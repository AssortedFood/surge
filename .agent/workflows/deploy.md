# Deploy Workflow

Iterative deployment workflow for Surge. Continuously check and fix issues until the container is healthy.

## Prerequisites

- All changes committed to git
- Docker daemon running
- Access to docker-compose directory at `/home/oxi/docker-compose`

---

## Phase 1: Pre-Deploy Checks

Run all checks before attempting deployment:

```bash
pnpm run lint
pnpm run format:check
pnpm test
```

**If any check fails:** Fix the issue, commit the fix, and re-run checks.

---

## Phase 2: Build and Push

Run the deployment script:

```bash
./deploy.sh
```

**Expected output:**
- Lint passes
- Format check passes
- Tests pass (20 tests)
- Docker image builds successfully
- Image pushes to `0xidising/surge:latest`
- Container restarts

**If build fails:** Check Dockerfile syntax, dependencies, or Prisma generation issues.

---

## Phase 3: Container Health Check

After deployment, verify container health:

```bash
sleep 5 && docker logs surge --tail 50
```

### Healthy Output Indicators

Look for these signs of a healthy container:

```
Application starting...
--- Scheduler checking for due data sync ---
⏰ Data sync scheduler running, will check every minute.
--- Running Post Pipeline ---
⏰ Post pipeline running every 60 seconds.
```

### Common Errors and Fixes

#### 1. Missing Export Error

```
SyntaxError: The requested module './syncPosts.js' does not provide an export named 'syncNewPosts'
```

**Fix:** Add `export` keyword to the function declaration in the source file.

#### 2. Database Not Found

```
Environment variable not found: DATABASE_URL
```

**Fix:** Check `/home/oxi/docker-compose/.env` has `SURGE_DATABASE_URL` set and `apps.yml` maps it correctly:
```yaml
environment:
  DATABASE_URL: ${SURGE_DATABASE_URL}
```

#### 3. Table Does Not Exist

```
The table `main.AppState` does not exist in the current database
```

**Fix:** Initialize the database schema:
```bash
cd /home/oxi/docker-compose
docker compose run -e DATABASE_URL="file:/usr/src/app/data/database.db" --rm surge npx prisma@6 db push --skip-generate
```

#### 4. Unable to Open Database File

```
Error querying the database: Error code 14: Unable to open the database file
```

**Fix:** Ensure DATABASE_URL uses absolute path:
```
SURGE_DATABASE_URL="file:/usr/src/app/data/database.db"
```

Note: Prisma resolves relative paths from the schema location (`/usr/src/app/prisma/`), not the working directory.

#### 5. Puppeteer Sandbox Error

```
Running as root without --no-sandbox is not supported
```

**Fix:** Add sandbox flags to Puppeteer launch options in `src/syncPosts.js`:
```javascript
browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
```

#### 6. Volume Mount Issues

If database changes aren't persisting, verify the volume mount:

```bash
docker inspect surge | grep -A 10 "Mounts"
```

Expected mount:
```
Source: /home/oxi/docker-compose/containers/surge
Destination: /usr/src/app/data
```

---

## Phase 4: Iterative Fix Loop

If container is unhealthy:

1. **Identify error** from `docker logs surge --tail 50`
2. **Fix the issue** in source code or configuration
3. **Run tests** to verify fix doesn't break anything
4. **Commit the fix** with descriptive message
5. **Redeploy** with `./deploy.sh`
6. **Check logs again** - repeat until healthy

```bash
# Quick iteration loop
pnpm test && git add -A && git commit -m "fix: <description>" && ./deploy.sh && sleep 5 && docker logs surge --tail 30
```

---

## Phase 5: Verification

Once container shows healthy logs, verify functionality:

```bash
# Check container is running
docker ps | grep surge

# Check database has tables
docker exec surge sh -c "ls -la /usr/src/app/data/"

# Monitor logs for a full cycle
docker logs surge -f
```

### Success Criteria

- Container status: `Up` (not restarting)
- No error messages in logs
- Data sync scheduler running
- Post pipeline running
- Rate limiting working (shows remaining time if recently fetched)

---

## Configuration Reference

### Environment Variables (docker-compose .env)

```env
SURGE_DATABASE_URL="file:/usr/src/app/data/database.db"
SURGE_USER_AGENT="surge: item-price-analysis-bot - @username on Discord"
SURGE_RSS_PAGE_URL="https://secure.runescape.com/m=news/a=13/latest_news.rss?oldschool=true"
SURGE_MAPPING_API_URL="https://prices.runescape.wiki/api/v1/osrs/mapping"
SURGE_LATEST_API_URL="https://prices.runescape.wiki/api/v1/osrs/latest"
SURGE_RATE_LIMIT_SECONDS="60"
SURGE_DATA_SYNC_INTERVAL_MINUTES="360"
SURGE_OPENAI_API_KEY="sk-..."
SURGE_OPENAI_MODEL="gpt-5-mini"
SURGE_TELEGRAM_BOT_TOKEN="..."
SURGE_TELEGRAM_CHAT_ID="..."
SURGE_INCLUDED_CHANGE_TYPES=["Price increase","Price decrease"]
SURGE_MARGIN_THRESHOLD="1000000"
SURGE_PRICE_VARIANCE_PERCENT="0.05"
```

### Docker Compose Service (apps.yml)

```yaml
surge:
  <<: *defaults
  image: 0xidising/surge:latest
  container_name: surge
  pull_policy: always
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
    TELEGRAM_BOT_TOKEN: ${SURGE_TELEGRAM_BOT_TOKEN}
    TELEGRAM_CHAT_ID: ${SURGE_TELEGRAM_CHAT_ID}
    INCLUDED_CHANGE_TYPES: ${SURGE_INCLUDED_CHANGE_TYPES}
    MARGIN_THRESHOLD: ${SURGE_MARGIN_THRESHOLD}
    PRICE_VARIANCE_PERCENT: ${SURGE_PRICE_VARIANCE_PERCENT}
  volumes:
    - ${DIR_CONTAINERS}/surge:/usr/src/app/data
```
