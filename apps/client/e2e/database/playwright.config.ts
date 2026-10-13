import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "database.spec.ts",
  workers: 1,
  timeout: 60_000,
  outputDir:
    process.env.DATABASE_TABLES_OUTPUT_DIR ??
    "../../../../artifacts/database/browser",
  use: {
    baseURL: process.env.DATABASE_TABLES_BASE_URL,
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Europe/Moscow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: path.resolve(
          __dirname,
          "../../../../artifacts/database/browser-results.json",
        ),
      },
    ],
  ],
});
