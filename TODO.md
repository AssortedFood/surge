# TODO

- margin threshold
- fuzzy name matching/ai name matching
- add price tracking for identified items and save that data over set periods to identify optimal sale times
- add profit tracking by interpreting screenshots sent to the telegram bot, timestamping, and saving to some file (csv?)
- find out an appropriate polling threshold
- bugfix:

```
surge  | ❌ Error processing post 16: Error: Failed to fetch URL https://secure.runescape.com/m=news/a=13/summer-sweep-up-blog-update-combat--loot?oldschool=1: HTTP 404
surge  |     at fetchAndSavePost (file:///usr/src/app/src/rssPostFetcher.js:43:11)
surge  |     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
surge  |     at async fetchAndSavePost (file:///usr/src/app/src/index.js:54:7)
surge  |     at async processOnePost (file:///usr/src/app/src/index.js:143:5)
surge  | ⚠️ Sent post-processing error notification for post 16.
surge  | ⚠️ RSS polling error:
surge  | ❌ Error in pollRss: Error: Failed to fetch RSS page: HTTP 404
surge  |     at fetchRssXml (file:///usr/src/app/src/rssChecker.js:30:11)
surge  |     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
surge  |     at async getNewRssPosts (file:///usr/src/app/src/rssChecker.js:93:19)
surge  |     at async Timeout.pollRss [as _onTimeout] (file:///usr/src/app/src/index.js:191:22)
surge  | Failed to fetch RSS page: HTTP 404
surge  | ❌ Error in pollRss: Error: Failed to fetch RSS page: HTTP 404
surge  |     at fetchRssXml (file:///usr/src/app/src/rssChecker.js:30:11)
surge  |     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
surge  | ⚠️ RSS polling error:
surge  | Failed to fetch RSS page: HTTP 404
surge  |     at async getNewRssPosts (file:///usr/src/app/src/rssChecker.js:93:19)
surge  |     at async Timeout.pollRss [as _onTimeout] (file:///usr/src/app/src/index.js:191:22)
surge  | ❌ Error in pollRss: Error: Failed to fetch RSS page: HTTP 404
surge  |     at fetchRssXml (file:///usr/src/app/src/rssChecker.js:30:11)
surge  |     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
surge  |     at async getNewRssPosts (file:///usr/src/app/src/rssChecker.js:93:19)
surge  |     at async Timeout.pollRss [as _onTimeout] (file:///usr/src/app/src/index.js:191:22)
surge  | ⚠️ RSS polling error:
surge  | Failed to fetch RSS page: HTTP 404
surge  | ❌ Error in pollRss: Error: Failed to fetch RSS page: HTTP 404
surge  |     at fetchRssXml (file:///usr/src/app/src/rssChecker.js:30:11)
surge  |     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
surge  |     at async getNewRssPosts (file:///usr/src/app/src/rssChecker.js:93:19)
surge  |     at async Timeout.pollRss [as _onTimeout] (file:///usr/src/app/src/index.js:191:22)
surge  | ⚠️ RSS polling error:
surge  | Failed to fetch RSS page: HTTP 404
surge  | ⚠️ RSS polling error:
surge  | ❌ Error in pollRss: Error: Failed to fetch RSS page: HTTP 404
surge  |     at fetchRssXml (file:///usr/src/app/src/rssChecker.js:30:11)
surge  |     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
surge  |     at async getNewRssPosts (file:///usr/src/app/src/rssChecker.js:93:19)
surge  |     at async Timeout.pollRss [as _onTimeout] (file:///usr/src/app/src/index.js:191:22)
surge  | Failed to fetch RSS page: HTTP 404
surge  | ❌ Error in pollRss: Error: Failed to fetch RSS page: HTTP 404
surge  |     at fetchRssXml (file:///usr/src/app/src/rssChecker.js:30:11)
surge  |     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
surge  |     at async getNewRssPosts (file:///usr/src/app/src/rssChecker.js:93:19)
surge  |     at async Timeout.pollRss [as _onTimeout] (file:///usr/src/app/src/index.js:191:22)
surge  | ⚠️ RSS polling error:
surge  | Failed to fetch RSS page: HTTP 404
surge  | ⚠️ RSS polling error:
surge  | Failed to fetch RSS page: HTTP 404
surge  | ❌ Error in pollRss: Error: Failed to fetch RSS page: HTTP 404
surge  |     at fetchRssXml (file:///usr/src/app/src/rssChecker.js:30:11)
surge  |     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
surge  |     at async getNewRssPosts (file:///usr/src/app/src/rssChecker.js:93:19)
surge  |     at async Timeout.pollRss [as _onTimeout] (file:///usr/src/app/src/index.js:191:22)
surge  | ⚠️ RSS polling error:
surge  | Failed to fetch RSS page: HTTP 404
surge  | ❌ Error in pollRss: Error: Failed to fetch RSS page: HTTP 404
surge  |     at fetchRssXml (file:///usr/src/app/src/rssChecker.js:30:11)
surge  |     at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
surge  |     at async getNewRssPosts (file:///usr/src/app/src/rssChecker.js:93:19)
surge  |     at async Timeout.pollRss [as _onTimeout] (file:///usr/src/app/src/index.js:191:22)
```
