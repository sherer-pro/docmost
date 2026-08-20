import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const auditRoot = path.resolve(
  process.env.DOCMOST_AI_AUDIT_ROOT ??
    path.resolve(process.cwd(), "../../output/audit/ai-assistant-2026-08-07"),
);
const baseURL = process.env.DOCMOST_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e/ai/specs",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  outputDir: path.join(auditRoot, "playwright-artifacts"),
  reporter: [
    ["list"],
    ["json", { outputFile: path.join(auditRoot, "playwright-results.json") }],
    [
      "html",
      { outputFolder: path.join(auditRoot, "playwright-html"), open: "never" },
    ],
  ],
  use: {
    baseURL,
    timezoneId: "Europe/Moscow",
    colorScheme: "light",
    trace: "off",
    video: "on",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "chromium-ru-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        locale: "ru-RU",
      },
    },
    {
      name: "chromium-en-desktop",
      testMatch:
        /(?:admin-guide|localization-responsive|streaming-recovery)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        locale: "en-US",
      },
    },
    {
      name: "firefox-streaming",
      testMatch: /streaming-recovery\.spec\.ts/,
      use: { ...devices["Desktop Firefox"], locale: "en-US" },
    },
    {
      name: "pixel-7",
      testMatch: /localization-responsive\.spec\.ts/,
      use: { ...devices["Pixel 7"], locale: "ru-RU" },
    },
    {
      name: "narrow-ai-panel",
      testMatch: /localization-responsive\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 820, height: 900 },
        locale: "ru-RU",
      },
    },
  ],
});
