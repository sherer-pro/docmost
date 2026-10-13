import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "database.live.spec.ts",
  workers: 1,
  timeout: 60_000,
  outputDir: path.join(process.env.DATABASE_LIVE_OUTPUT!, "browser"),
  use: {
    baseURL: process.env.DATABASE_LIVE_URL,
    storageState: JSON.parse(process.env.DATABASE_LIVE_SESSIONS!).editor,
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Europe/Moscow",
    // Authentication stays in memory; traces would persist cookies and headers.
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.join(
          process.env.DATABASE_LIVE_OUTPUT!,
          "browser-results.json",
        ),
      },
    ],
  ],
});
