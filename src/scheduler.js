// src/scheduler.js
import cron from "node-cron";
import { fetchAndSaveAllItems } from "./allItemsFetcher.js";

// Run it immediately on startup (optional)
fetchAndSaveAllItems().catch(err => {
  console.error("[scheduler] Initial fetch failed:", err);
});

// Schedule “0 0 * * *” in UTC (midnight UTC every day)
cron.schedule(
  "0 0 * * *",
  () => {
    console.log("[scheduler] Running daily allItemsFetcher at 00:00 UTC");
    fetchAndSaveAllItems().catch(err => {
      console.error("[scheduler] Scheduled fetch failed:", err);
    });
  },
  {
    scheduled: true,
    timezone: "UTC"
  }
);

// Keep the process alive (node-cron does this automatically, 
// but if you export nothing else, add a log so “docker logs” shows it):
console.log("[scheduler] Scheduler is running (will fire at 00:00 UTC daily).");
